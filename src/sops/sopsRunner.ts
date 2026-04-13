import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SopsError, SopsErrorType } from '../types';
import { SettingsService } from '../services/settingsService';
import { logger } from '../services/loggerService';
import { getErrorMessage } from '../utils/errorUtils';

/**
 * Wrapper for SOPS CLI operations
 */
export class SopsRunner {
    constructor(private settingsService: SettingsService) {}

    private getWorkingDirectory(filePath: string): string {
        // SOPS looks for .sops.yaml from CWD and walks up the directory tree
        return path.dirname(filePath);
    }

    /**
     * Decrypt a file and return the decrypted content.
     * Automatically detects file type from extension.
     */
    async decrypt(filePath: string): Promise<string> {
        const ext = path.extname(filePath).slice(1);
        const fileType = this.getInputType(ext);
        logger.debug(`SopsRunner: Decrypting ${filePath} (type=${fileType})`);

        // For known structured formats, let SOPS handle it naturally
        // For binary/unknown formats, explicitly specify the type
        if (fileType === 'binary') {
            return this.runSops([
                '--decrypt',
                '--input-type', 'binary',
                '--output-type', 'binary',
                filePath
            ], filePath);
        }
        return this.runSops(['--decrypt', filePath], filePath);
    }

    /**
     * Encrypt a file and return the encrypted content.
     * Automatically detects file type from extension.
     * @param configPath Optional path to .sops.yaml/.sops.yml config file
     */
    async encrypt(filePath: string, configPath?: string): Promise<string> {
        const ext = path.extname(filePath).slice(1);
        const fileType = this.getInputType(ext);
        logger.debug(`SopsRunner: Encrypting ${filePath} (type=${fileType})`);

        // For known structured formats, let SOPS handle it naturally
        // For binary/unknown formats, explicitly specify the type
        if (fileType === 'binary') {
            return this.runSops([
                '--encrypt',
                '--input-type', 'binary',
                '--output-type', 'binary',
                filePath
            ], filePath, configPath);
        }
        return this.runSops(['--encrypt', filePath], filePath, configPath);
    }

    /**
     * Encrypt in-memory content for a logical file path.
     *
     * Stages the payload in a secure per-invocation temp file and passes
     * --filename-override so SOPS resolves creation_rules and infers the
     * input/output format from the *original* path, not the temp path.
     * This avoids the Windows-incompatible /dev/stdin trick that an
     * earlier stdin-based version relied on, while still satisfying the
     * rule-matching requirement that motivated dropping the previous
     * temp-file approach.
     *
     * @param configPath Optional path to .sops.yaml/.sops.yml config file
     */
    async encryptContent(content: string, filePath: string, configPath?: string): Promise<string> {
        logger.debug(`SopsRunner: Encrypting content for ${filePath}`);

        // Per-invocation directory with restrictive permissions so other
        // local users cannot read the plaintext while SOPS is reading it.
        const tempDir = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), 'sopsie-enc-')
        );
        if (process.platform !== 'win32') {
            await fs.promises.chmod(tempDir, 0o700);
        }
        const tempPath = path.join(tempDir, 'payload');
        await fs.promises.writeFile(tempPath, content, {
            encoding: 'utf8',
            mode: 0o600
        });

        try {
            const args = ['--encrypt', '--filename-override', filePath, tempPath];
            if (configPath) {
                args.unshift('--config', configPath);
            }
            const sopsPath = this.settingsService.getSopsPath();
            const timeout = this.settingsService.getTimeout();
            const cwd = this.getWorkingDirectory(filePath);
            return await this.runCommand(sopsPath, args, cwd, '', timeout);
        } finally {
            try {
                await fs.promises.unlink(tempPath);
                await fs.promises.rmdir(tempDir);
            } catch (err) {
                logger.warn(
                    `Failed to clean up encrypt temp file ${tempPath}: ${getErrorMessage(err)}`
                );
            }
        }
    }

    /**
     * Update keys in an encrypted file based on .sops.yaml.
     * Re-encrypts the file with the keys defined in the matching creation rule.
     */
    async updateKeys(filePath: string): Promise<void> {
        logger.debug(`SopsRunner: Updating keys for ${filePath}`);
        await this.runSops(['updatekeys', '--yes', filePath], filePath);
    }

    /**
     * Rotate the data key used to encrypt the file.
     * Decrypts and re-encrypts all values with a new data key.
     */
    async rotate(filePath: string): Promise<void> {
        logger.debug(`SopsRunner: Rotating data key for ${filePath}`);
        await this.runSops(['rotate', '--in-place', filePath], filePath);
    }

    /**
     * Check if SOPS CLI is available
     */
    async checkCliAvailable(): Promise<boolean> {
        try {
            const sopsPath = this.settingsService.getSopsPath();
            await this.runCommand(sopsPath, ['--version'], process.cwd(), '', 5000);
            return true;
        } catch (error) {
            logger.debug(`SOPS CLI check failed: ${getErrorMessage(error)}`);
            return false;
        }
    }

    /**
     * Get SOPS version
     */
    async getVersion(): Promise<string | null> {
        try {
            const sopsPath = this.settingsService.getSopsPath();
            const result = await this.runCommand(sopsPath, ['--version'], process.cwd(), '', 5000);
            return result.trim();
        } catch (error) {
            logger.debug(`Failed to get SOPS version: ${getErrorMessage(error)}`);
            return null;
        }
    }

    private getInputType(ext: string): string {
        switch (ext.toLowerCase()) {
            case 'json':
                return 'json';
            case 'env':
                return 'dotenv';
            case 'ini':
                return 'ini';
            case 'yaml':
            case 'yml':
                return 'yaml';
            default:
                // Unknown extensions use binary format
                return 'binary';
        }
    }

    private async runSops(args: string[], filePath: string, configPath?: string): Promise<string> {
        const sopsPath = this.settingsService.getSopsPath();
        const timeout = this.settingsService.getTimeout();
        const cwd = this.getWorkingDirectory(filePath);

        // If a config path is provided, add --config flag
        // This works around SOPS CLI's limitation of only accepting .sops.yaml (not .sops.yml)
        if (configPath) {
            logger.debug(`SopsRunner: Using explicit config path: ${configPath}`);
            args = ['--config', configPath, ...args];
        } else {
            logger.debug(`SopsRunner: No explicit config path, SOPS will search from CWD: ${cwd}`);
        }

        return this.runCommand(sopsPath, args, cwd, '', timeout);
    }

    private runCommand(
        cmd: string,
        args: string[],
        cwd: string,
        stdin: string,
        timeout: number
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            // Disable SOPS version check to suppress deprecation warning
            const env = { ...process.env, SOPS_DISABLE_VERSION_CHECK: '1' };
            const proc = spawn(cmd, args, { cwd, env });
            let isSettled = false;

            let stdout = '';
            let stderr = '';

            // Helper to ensure process is cleaned up
            const killProcess = (): void => {
                if (!proc.killed) {
                    proc.kill('SIGTERM');
                    // Give it a moment, then force kill if still running
                    setTimeout(() => {
                        if (!proc.killed) {
                            proc.kill('SIGKILL');
                        }
                    }, 1000);
                }
            };

            const timer = setTimeout(() => {
                if (!isSettled) {
                    isSettled = true;
                    killProcess();
                    reject(this.createError(SopsErrorType.Timeout, `Operation timed out after ${timeout}ms`));
                }
            }, timeout);

            proc.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            if (stdin) {
                proc.stdin.end(stdin);
            } else {
                proc.stdin.end();
            }

            proc.on('close', (code: number | null) => {
                clearTimeout(timer);
                if (!isSettled) {
                    isSettled = true;
                    if (code === 0) {
                        resolve(stdout);
                    } else {
                        reject(this.parseError(stderr, code));
                    }
                }
            });

            proc.on('error', (err: Error) => {
                clearTimeout(timer);
                if (!isSettled) {
                    isSettled = true;
                    killProcess();
                    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                        reject(
                            this.createError(
                                SopsErrorType.CliNotFound,
                                `SOPS CLI not found at "${cmd}"`,
                                'Install SOPS or update the sopsPath setting'
                            )
                        );
                    } else {
                        reject(
                            this.createError(SopsErrorType.Unknown, `Failed to run SOPS: ${err.message}`)
                        );
                    }
                }
            });
        });
    }

    private parseError(stderr: string, code: number | null): SopsError {
        const lowerStderr = stderr.toLowerCase();

        if (
            lowerStderr.includes('could not decrypt') ||
            lowerStderr.includes('failed to get the data key') ||
            lowerStderr.includes('cannot find key')
        ) {
            return this.createError(
                SopsErrorType.KeyAccessDenied,
                'Unable to decrypt file - key access denied',
                stderr,
                'Check your encryption key configuration (age, GPG, KMS, etc.)'
            );
        }

        if (lowerStderr.includes('config file not found') || lowerStderr.includes('.sops.yaml')) {
            return this.createError(
                SopsErrorType.ConfigNotFound,
                'No SOPS configuration found',
                stderr,
                'Create a .sops.yaml or .sops.yml file in your workspace root'
            );
        }

        if (lowerStderr.includes('error parsing') || lowerStderr.includes('yaml:')) {
            return this.createError(
                SopsErrorType.InvalidFile,
                'Invalid file format',
                stderr,
                'Ensure the file is valid YAML/JSON'
            );
        }

        if (lowerStderr.includes('encrypt')) {
            return this.createError(SopsErrorType.EncryptionFailed, 'Encryption failed', stderr);
        }

        if (lowerStderr.includes('decrypt')) {
            return this.createError(SopsErrorType.DecryptionFailed, 'Decryption failed', stderr);
        }

        return this.createError(
            SopsErrorType.Unknown,
            `SOPS failed with code ${code}`,
            stderr
        );
    }

    private createError(
        type: SopsErrorType,
        message: string,
        details?: string,
        suggestedAction?: string
    ): SopsError {
        return {
            type,
            message,
            details,
            recoverable: type !== SopsErrorType.CliNotFound,
            suggestedAction
        };
    }
}

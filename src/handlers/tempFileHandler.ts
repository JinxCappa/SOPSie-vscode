import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SopsRunner } from '../sops/sopsRunner';
import { ConfigManager } from '../config/configManager';
import { logger } from '../services/loggerService';
import { getErrorMessage } from '../utils/errorUtils';

/**
 * Manages temporary files for edit-in-place functionality.
 * Tracks mapping between temp files and original encrypted files,
 * handles encryption on save, and cleanup on close.
 */
export class TempFileHandler implements vscode.Disposable {
    private tempToOriginal = new Map<string, string>();
    private disposables: vscode.Disposable[] = [];

    constructor(
        private sopsRunner: SopsRunner,
        private configManager: ConfigManager
    ) {
        // Listen for document save events
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc) => {
                this.onDocumentSaved(doc);
            })
        );

        // Listen for document close events
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument((doc) => {
                this.onDocumentClosed(doc);
            })
        );
    }

    /**
     * Create a temporary file with decrypted content
     * @returns The URI of the temp file
     */
    async createTempFile(
        originalUri: vscode.Uri,
        decryptedContent: string
    ): Promise<vscode.Uri> {
        const originalPath = originalUri.fsPath;
        const ext = path.extname(originalPath);
        const nameWithoutExt = path.basename(originalPath, ext);

        // Create a per-invocation subdirectory with user-only permissions.
        // This prevents other local users from reading the plaintext and
        // avoids predictable filenames in a shared temp directory.
        const tempDir = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), 'sopsie-')
        );
        if (process.platform !== 'win32') {
            await fs.promises.chmod(tempDir, 0o700);
        }

        const tempFileName = `${nameWithoutExt}.sops-edit${ext}`;
        const tempPath = path.join(tempDir, tempFileName);

        await fs.promises.writeFile(tempPath, decryptedContent, {
            encoding: 'utf8',
            mode: 0o600
        });

        this.tempToOriginal.set(tempPath, originalPath);
        logger.debug(`Created temp file: ${tempPath} -> ${originalPath}`);

        return vscode.Uri.file(tempPath);
    }

    /**
     * Handle document save - encrypt and write back to original
     */
    private async onDocumentSaved(doc: vscode.TextDocument): Promise<void> {
        const tempPath = doc.uri.fsPath;
        const originalPath = this.tempToOriginal.get(tempPath);

        if (!originalPath) {
            // Not a managed temp file
            return;
        }

        try {
            const content = doc.getText();

            // Show progress notification
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Encrypting and saving to original file...',
                    cancellable: false
                },
                async () => {
                    // Find the config file to use (supports both .sops.yaml and .sops.yml)
                    const originalUri = vscode.Uri.file(originalPath);
                    const configPath = this.configManager.getConfigPath(originalUri);

                    // Encrypt content using SOPS
                    const encrypted = await this.sopsRunner.encryptContent(
                        content,
                        originalPath,
                        configPath ?? undefined
                    );

                    // Write encrypted content to original file
                    await fs.promises.writeFile(originalPath, encrypted, 'utf8');
                }
            );

            vscode.window.showInformationMessage(
                `Encrypted and saved to ${path.basename(originalPath)}`
            );
            logger.debug(`Encrypted temp file ${tempPath} -> ${originalPath}`);
        } catch (error) {
            logger.error(`Failed to encrypt: ${getErrorMessage(error)}`);
            vscode.window.showErrorMessage(
                `Failed to encrypt and save: ${getErrorMessage(error)}`
            );
        }
    }

    /**
     * Handle document close - clean up temp file tracking and delete file
     * Note: EditorGroupTracker handles auto-collapse via DocumentWatcher
     */
    private onDocumentClosed(doc: vscode.TextDocument): void {
        const tempPath = doc.uri.fsPath;

        if (this.tempToOriginal.has(tempPath)) {
            this.tempToOriginal.delete(tempPath);
            logger.debug(`Cleaned up temp file tracking: ${tempPath}`);
            this.removeTempFile(tempPath);
        }
    }

    private async removeTempFile(tempPath: string): Promise<void> {
        try {
            await fs.promises.unlink(tempPath);
        } catch (err) {
            logger.warn(`Could not delete temp file ${tempPath}: ${getErrorMessage(err)}`);
        }
        // Best-effort removal of the per-invocation parent directory.
        try {
            await fs.promises.rmdir(path.dirname(tempPath));
        } catch {
            // Directory may be non-empty or already gone; ignore.
        }
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];

        // Clean up any remaining temp files
        for (const tempPath of this.tempToOriginal.keys()) {
            this.removeTempFile(tempPath);
        }
        this.tempToOriginal.clear();
    }
}

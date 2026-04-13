import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TempFileHandler } from '../../handlers/tempFileHandler';
import { SopsRunner } from '../../sops/sopsRunner';
import { ConfigManager } from '../../config/configManager';

/**
 * Stub SopsRunner — only encryptContent is exercised by the save path.
 */
class StubRunner {
    encryptCalls: Array<{ content: string; filePath: string; configPath?: string }> = [];
    encryptResult: string | Error = 'ENCRYPTED';
    async encryptContent(content: string, filePath: string, configPath?: string): Promise<string> {
        this.encryptCalls.push({ content, filePath, configPath });
        if (this.encryptResult instanceof Error) {
            throw this.encryptResult;
        }
        return this.encryptResult;
    }
}

class StubConfigManager {
    configPath: string | null = null;
    getConfigPath(_uri: vscode.Uri): string | null {
        return this.configPath;
    }
}

function makeHandler() {
    const runner = new StubRunner();
    const cfg = new StubConfigManager();
    const handler = new TempFileHandler(
        runner as unknown as SopsRunner,
        cfg as unknown as ConfigManager
    );
    return { handler, runner, cfg };
}

suite('tempFileHandler', () => {
    let toDispose: TempFileHandler[] = [];

    teardown(() => {
        toDispose.forEach((h) => h.dispose());
        toDispose = [];
    });

    test('createTempFile writes content to a per-invocation temp directory', async () => {
        const { handler } = makeHandler();
        toDispose.push(handler);

        const original = vscode.Uri.file('/repo/secrets/db.yaml');
        const tempUri = await handler.createTempFile(original, 'plaintext-content');

        const tempPath = tempUri.fsPath;
        assert.ok(fs.existsSync(tempPath), 'temp file should exist');

        const content = await fs.promises.readFile(tempPath, 'utf8');
        assert.strictEqual(content, 'plaintext-content');

        // Filename preserves stem + extension and tags with .sops-edit
        assert.match(path.basename(tempPath), /^db\.sops-edit\.yaml$/);

        // Each call gets its own directory under os.tmpdir()
        assert.match(path.dirname(tempPath), /sopsie-/);
    });

    test('createTempFile sets file 0o600 and dir 0o700 on POSIX', async function () {
        if (process.platform === 'win32') {
            this.skip();
            return;
        }
        const { handler } = makeHandler();
        toDispose.push(handler);

        const tempUri = await handler.createTempFile(
            vscode.Uri.file('/repo/x.yaml'),
            'data'
        );
        const tempPath = tempUri.fsPath;
        const fileMode = (await fs.promises.stat(tempPath)).mode & 0o777;
        const dirMode = (await fs.promises.stat(path.dirname(tempPath))).mode & 0o777;
        assert.strictEqual(fileMode, 0o600);
        assert.strictEqual(dirMode, 0o700);
    });

    test('two createTempFile calls produce distinct directories', async () => {
        const { handler } = makeHandler();
        toDispose.push(handler);

        const a = await handler.createTempFile(vscode.Uri.file('/repo/a.yaml'), 'A');
        const b = await handler.createTempFile(vscode.Uri.file('/repo/a.yaml'), 'B');
        assert.notStrictEqual(path.dirname(a.fsPath), path.dirname(b.fsPath));
    });

    test('discardTempFile removes the file and untracks it', async () => {
        const { handler } = makeHandler();
        toDispose.push(handler);

        const tempUri = await handler.createTempFile(
            vscode.Uri.file('/repo/x.yaml'),
            'data'
        );
        await handler.discardTempFile(tempUri);
        assert.ok(!fs.existsSync(tempUri.fsPath), 'file should be deleted');

        // Calling discard again is a no-op (already untracked)
        await handler.discardTempFile(tempUri);
    });

    test('discardTempFile is a no-op for unknown URIs', async () => {
        const { handler } = makeHandler();
        toDispose.push(handler);
        // Should not throw even though we never created this file.
        await handler.discardTempFile(vscode.Uri.file('/tmp/never-tracked'));
    });

    test('dispose synchronously deletes all tracked temp files', async () => {
        const { handler } = makeHandler();
        // Note: NOT pushed to toDispose — this test calls dispose itself.

        const a = await handler.createTempFile(vscode.Uri.file('/repo/a.yaml'), 'A');
        const b = await handler.createTempFile(vscode.Uri.file('/repo/b.yaml'), 'B');

        handler.dispose();

        assert.ok(!fs.existsSync(a.fsPath), 'a should be deleted by dispose');
        assert.ok(!fs.existsSync(b.fsPath), 'b should be deleted by dispose');
    });

    test('save flow encrypts content via SopsRunner and writes back to original', async () => {
        const { handler, runner } = makeHandler();
        toDispose.push(handler);

        // Pretend we have a real file on disk to act as the "original"
        const originalDir = await fs.promises.mkdtemp(
            path.join(require('os').tmpdir(), 'sopsie-orig-')
        );
        const originalPath = path.join(originalDir, 'secret.yaml');
        await fs.promises.writeFile(originalPath, 'PRIOR-ENCRYPTED', 'utf8');

        const tempUri = await handler.createTempFile(
            vscode.Uri.file(originalPath),
            'plaintext-edited'
        );

        // Stub a TextDocument matching the temp file
        const doc = {
            uri: tempUri,
            getText: () => 'plaintext-edited'
        } as unknown as vscode.TextDocument;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (handler as any).onDocumentSaved(doc);

        assert.strictEqual(runner.encryptCalls.length, 1);
        assert.strictEqual(runner.encryptCalls[0].content, 'plaintext-edited');
        assert.strictEqual(runner.encryptCalls[0].filePath, originalPath);

        const onDisk = await fs.promises.readFile(originalPath, 'utf8');
        assert.strictEqual(onDisk, 'ENCRYPTED');

        await fs.promises.rm(originalDir, { recursive: true, force: true });
    });

    test('save flow ignores documents that are not managed temp files', async () => {
        const { handler, runner } = makeHandler();
        toDispose.push(handler);

        const doc = {
            uri: vscode.Uri.file('/some/random/file.yaml'),
            getText: () => 'unrelated'
        } as unknown as vscode.TextDocument;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (handler as any).onDocumentSaved(doc);
        assert.strictEqual(runner.encryptCalls.length, 0);
    });

    test('save flow forwards configManager.getConfigPath result to the runner', async () => {
        const { handler, runner, cfg } = makeHandler();
        toDispose.push(handler);

        cfg.configPath = '/repo/.sops.yml';

        const originalDir = await fs.promises.mkdtemp(
            path.join(require('os').tmpdir(), 'sopsie-orig-')
        );
        const originalPath = path.join(originalDir, 'secret.yaml');
        await fs.promises.writeFile(originalPath, '', 'utf8');

        const tempUri = await handler.createTempFile(
            vscode.Uri.file(originalPath),
            'data'
        );
        const doc = {
            uri: tempUri,
            getText: () => 'data'
        } as unknown as vscode.TextDocument;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (handler as any).onDocumentSaved(doc);

        assert.strictEqual(runner.encryptCalls[0].configPath, '/repo/.sops.yml');

        await fs.promises.rm(originalDir, { recursive: true, force: true });
    });

    test('save flow surfaces encrypt errors without throwing', async () => {
        const { handler, runner } = makeHandler();
        toDispose.push(handler);

        runner.encryptResult = new Error('encrypt boom');

        const originalDir = await fs.promises.mkdtemp(
            path.join(require('os').tmpdir(), 'sopsie-orig-')
        );
        const originalPath = path.join(originalDir, 'secret.yaml');
        await fs.promises.writeFile(originalPath, 'PRIOR', 'utf8');

        const tempUri = await handler.createTempFile(
            vscode.Uri.file(originalPath),
            'data'
        );
        const doc = {
            uri: tempUri,
            getText: () => 'data'
        } as unknown as vscode.TextDocument;

        // Should NOT throw — error is surfaced through showErrorMessage
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (handler as any).onDocumentSaved(doc);

        // Original file untouched (encryption failed before write)
        const onDisk = await fs.promises.readFile(originalPath, 'utf8');
        assert.strictEqual(onDisk, 'PRIOR');

        await fs.promises.rm(originalDir, { recursive: true, force: true });
    });
});

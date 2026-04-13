import * as assert from 'assert';
import * as vscode from 'vscode';
import { DecryptedContentProvider } from '../../providers/decryptedContentProvider';
import { SopsRunner } from '../../sops/sopsRunner';
import { SOPS_DECRYPTED_SCHEME } from '../../types';

/**
 * Stub SopsRunner that returns canned decrypt results and tracks call count.
 * Just enough surface to satisfy the provider — the runner's real CLI work
 * is exercised elsewhere.
 */
class StubRunner {
    decryptCalls = 0;
    decryptResult: string | Error = 'plaintext-content';
    async decrypt(_filePath: string): Promise<string> {
        this.decryptCalls++;
        if (this.decryptResult instanceof Error) {
            throw this.decryptResult;
        }
        return this.decryptResult;
    }
}

function previewUriFor(originalPath: string): vscode.Uri {
    return vscode.Uri.from({
        scheme: SOPS_DECRYPTED_SCHEME,
        path: 'tab-title',
        query: originalPath
    });
}

suite('decryptedContentProvider', () => {
    test('decrypts on first request, caches subsequent reads', async () => {
        const stub = new StubRunner();
        const p = new DecryptedContentProvider(stub as unknown as SopsRunner);

        const uri = previewUriFor('/repo/secret.yaml');
        const first = await p.provideTextDocumentContent(uri);
        const second = await p.provideTextDocumentContent(uri);

        assert.strictEqual(stub.decryptCalls, 1);
        assert.strictEqual(first, second);
        p.dispose();
    });

    test('YAML preview includes a read-only header banner', async () => {
        const p = new DecryptedContentProvider(new StubRunner() as unknown as SopsRunner);
        const content = await p.provideTextDocumentContent(previewUriFor('/repo/secret.yaml'));
        assert.match(content, /SOPS DECRYPTED PREVIEW/);
        assert.ok(content.endsWith('plaintext-content'));
        p.dispose();
    });

    test('JSON preview omits the header (JSON has no comment syntax)', async () => {
        const p = new DecryptedContentProvider(new StubRunner() as unknown as SopsRunner);
        const content = await p.provideTextDocumentContent(previewUriFor('/repo/secret.json'));
        assert.strictEqual(content, 'plaintext-content');
        p.dispose();
    });

    test('decryption errors are surfaced in the document body, not thrown', async () => {
        const stub = new StubRunner();
        stub.decryptResult = new Error('bad key');
        const p = new DecryptedContentProvider(stub as unknown as SopsRunner);

        const content = await p.provideTextDocumentContent(previewUriFor('/repo/x.yaml'));
        assert.match(content, /Failed to decrypt/);
        assert.match(content, /bad key/);
        p.dispose();
    });

    test('error responses are not cached', async () => {
        const stub = new StubRunner();
        stub.decryptResult = new Error('boom');
        const p = new DecryptedContentProvider(stub as unknown as SopsRunner);

        const uri = previewUriFor('/repo/x.yaml');
        await p.provideTextDocumentContent(uri);
        await p.provideTextDocumentContent(uri);
        // Both calls hit the stub because failures bypass the cache.
        assert.strictEqual(stub.decryptCalls, 2);
        p.dispose();
    });

    test('LRU eviction caps cache at MAX_CACHE_SIZE', async () => {
        const stub = new StubRunner();
        const p = new DecryptedContentProvider(stub as unknown as SopsRunner);

        // Fill cache: 20 distinct paths
        for (let i = 0; i < 20; i++) {
            await p.provideTextDocumentContent(previewUriFor(`/repo/file${i}.yaml`));
        }
        assert.strictEqual(stub.decryptCalls, 20);

        // Push beyond the cap — file0 should be evicted
        await p.provideTextDocumentContent(previewUriFor('/repo/file20.yaml'));
        assert.strictEqual(stub.decryptCalls, 21);

        // Re-request the most recent (file20): cached
        await p.provideTextDocumentContent(previewUriFor('/repo/file20.yaml'));
        assert.strictEqual(stub.decryptCalls, 21);

        // Re-request file0: was evicted, should re-decrypt
        await p.provideTextDocumentContent(previewUriFor('/repo/file0.yaml'));
        assert.strictEqual(stub.decryptCalls, 22);
        p.dispose();
    });

    test('refresh fires onDidChange only for cached paths', async () => {
        const p = new DecryptedContentProvider(new StubRunner() as unknown as SopsRunner);
        let fired = 0;
        p.onDidChange(() => fired++);

        // Refresh with no cache → no event
        p.refresh('/repo/never-opened.yaml');
        assert.strictEqual(fired, 0);

        // Populate cache then refresh → event fires once
        await p.provideTextDocumentContent(previewUriFor('/repo/cached.yaml'));
        p.refresh('/repo/cached.yaml');
        assert.strictEqual(fired, 1);

        // Subsequent refresh of the (now-evicted) entry → no event
        p.refresh('/repo/cached.yaml');
        assert.strictEqual(fired, 1);
        p.dispose();
    });

    test('createPreviewUri / getOriginalPath round-trip', () => {
        const original = vscode.Uri.file('/repo/secrets/db.yaml');
        const preview = DecryptedContentProvider.createPreviewUri(original);
        assert.strictEqual(preview.scheme, SOPS_DECRYPTED_SCHEME);
        assert.match(preview.path, /db\.yaml \(SOPS Preview\)/);
        assert.strictEqual(
            DecryptedContentProvider.getOriginalPath(preview),
            original.fsPath
        );
    });

    test('getLanguageId maps extensions correctly', () => {
        assert.strictEqual(DecryptedContentProvider.getLanguageId('/x.json'), 'json');
        assert.strictEqual(DecryptedContentProvider.getLanguageId('/x.yaml'), 'yaml');
        assert.strictEqual(DecryptedContentProvider.getLanguageId('/x.yml'), 'yaml');
        assert.strictEqual(DecryptedContentProvider.getLanguageId('/x.env'), 'dotenv');
        assert.strictEqual(DecryptedContentProvider.getLanguageId('/x.ini'), 'ini');
        assert.strictEqual(DecryptedContentProvider.getLanguageId('/x.bin'), 'plaintext');
    });
});

import * as assert from 'assert';
import * as vscode from 'vscode';
import { FileStateTracker } from '../../state/fileStateTracker';

const a = vscode.Uri.file('/repo/secrets/a.yaml');
const b = vscode.Uri.file('/repo/secrets/b.yaml');

suite('fileStateTracker', () => {
    test('starts empty', () => {
        const t = new FileStateTracker();
        assert.strictEqual(t.isMarkedDecrypted(a), false);
    });

    test('markDecrypted then isMarkedDecrypted returns true', () => {
        const t = new FileStateTracker();
        t.markDecrypted(a);
        assert.strictEqual(t.isMarkedDecrypted(a), true);
        assert.strictEqual(t.isMarkedDecrypted(b), false);
    });

    test('markEncrypted removes the file', () => {
        const t = new FileStateTracker();
        t.markDecrypted(a);
        t.markEncrypted(a);
        assert.strictEqual(t.isMarkedDecrypted(a), false);
    });

    test('markDecrypted is idempotent', () => {
        const t = new FileStateTracker();
        t.markDecrypted(a);
        t.markDecrypted(a);
        t.markEncrypted(a);
        assert.strictEqual(t.isMarkedDecrypted(a), false);
    });

    test('clearFile removes only the targeted file', () => {
        const t = new FileStateTracker();
        t.markDecrypted(a);
        t.markDecrypted(b);
        t.clearFile(a);
        assert.strictEqual(t.isMarkedDecrypted(a), false);
        assert.strictEqual(t.isMarkedDecrypted(b), true);
    });

    test('clear removes everything', () => {
        const t = new FileStateTracker();
        t.markDecrypted(a);
        t.markDecrypted(b);
        t.clear();
        assert.strictEqual(t.isMarkedDecrypted(a), false);
        assert.strictEqual(t.isMarkedDecrypted(b), false);
    });

    test('keys by URI string, not object identity', () => {
        const t = new FileStateTracker();
        t.markDecrypted(vscode.Uri.file('/repo/x.yaml'));
        // A freshly constructed Uri with the same path should still match.
        assert.strictEqual(
            t.isMarkedDecrypted(vscode.Uri.file('/repo/x.yaml')),
            true
        );
    });
});

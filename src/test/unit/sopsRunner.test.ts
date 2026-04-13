import * as assert from 'assert';
import { SopsRunner } from '../../sops/sopsRunner';
import { SopsError, SopsErrorType } from '../../types';
import { SettingsService } from '../../services/settingsService';

// parseError is private; accessed via cast for unit testing.
// This is a deliberate test-only escape hatch — keep it confined here.
function parseError(stderr: string, code: number | null = 1): SopsError {
    const runner = new SopsRunner({
        getSopsPath: () => 'sops',
        getTimeout: () => 5000
    } as unknown as SettingsService);
     
    return (runner as any).parseError(stderr, code);
}

suite('sopsRunner.parseError', () => {
    test('classifies "could not decrypt" as KeyAccessDenied', () => {
        const e = parseError('sops: could not decrypt data key with PGP key');
        assert.strictEqual(e.type, SopsErrorType.KeyAccessDenied);
        assert.match(e.message, /key access denied/i);
        assert.ok(e.suggestedAction);
        assert.strictEqual(e.recoverable, true);
    });

    test('classifies "failed to get the data key" as KeyAccessDenied', () => {
        const e = parseError('Error: Failed to get the data key required to decrypt');
        assert.strictEqual(e.type, SopsErrorType.KeyAccessDenied);
    });

    test('classifies "cannot find key" as KeyAccessDenied', () => {
        const e = parseError('cannot find key for given fingerprint');
        assert.strictEqual(e.type, SopsErrorType.KeyAccessDenied);
    });

    test('classifies "config file not found" as ConfigNotFound', () => {
        const e = parseError('config file not found in any parent directory');
        assert.strictEqual(e.type, SopsErrorType.ConfigNotFound);
        assert.match(e.suggestedAction ?? '', /\.sops\.yaml/);
    });

    test('classifies stderr containing ".sops.yaml" as ConfigNotFound', () => {
        // The current matcher treats any mention of .sops.yaml as a missing-config
        // signal. Lock in that behavior so we notice if it changes.
        const e = parseError('error reading .sops.yaml: permission denied');
        assert.strictEqual(e.type, SopsErrorType.ConfigNotFound);
    });

    test('classifies "yaml:" parse error as InvalidFile', () => {
        const e = parseError('yaml: line 5: did not find expected key');
        assert.strictEqual(e.type, SopsErrorType.InvalidFile);
    });

    test('classifies "error parsing" as InvalidFile', () => {
        const e = parseError('Error parsing JSON: unexpected token');
        assert.strictEqual(e.type, SopsErrorType.InvalidFile);
    });

    test('classifies generic encrypt failure as EncryptionFailed', () => {
        const e = parseError('failed to encrypt: something went wrong');
        assert.strictEqual(e.type, SopsErrorType.EncryptionFailed);
    });

    test('classifies generic decrypt failure as DecryptionFailed', () => {
        // Note: must not contain stronger key-access markers, otherwise it
        // would be categorised as KeyAccessDenied first.
        const e = parseError('failed to decrypt some value');
        assert.strictEqual(e.type, SopsErrorType.DecryptionFailed);
    });

    test('falls back to Unknown when no marker matches', () => {
        const e = parseError('some unrelated failure', 42);
        assert.strictEqual(e.type, SopsErrorType.Unknown);
        assert.match(e.message, /code 42/);
        assert.strictEqual(e.recoverable, true);
    });

    test('Unknown carries null exit code in message', () => {
        const e = parseError('boom', null);
        assert.match(e.message, /code null/);
    });

    test('KeyAccessDenied takes precedence over generic decrypt match', () => {
        const e = parseError('could not decrypt: failed to decrypt data');
        assert.strictEqual(e.type, SopsErrorType.KeyAccessDenied);
    });

    test('CliNotFound is not recoverable', () => {
        // Constructed via the public createError surface for symmetry — the
        // CliNotFound branch is set in the spawn error handler, not parseError.
        const runner = new SopsRunner({
            getSopsPath: () => 'sops',
            getTimeout: () => 5000
        } as unknown as SettingsService);
         
        const e = (runner as any).createError(SopsErrorType.CliNotFound, 'missing');
        assert.strictEqual(e.recoverable, false);
    });
});

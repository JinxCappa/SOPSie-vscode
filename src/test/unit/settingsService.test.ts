import * as assert from 'assert';
import * as vscode from 'vscode';
import { SettingsService } from '../../services/settingsService';

/**
 * SettingsService reads from vscode.workspace.getConfiguration('sopsie').
 * In the extension host, no extension is contributing 'sopsie' settings during
 * tests, so all reads return their built-in defaults.
 *
 * These tests therefore lock in default behavior and the timeout clamping
 * logic, which doesn't depend on user configuration.
 */
suite('settingsService', () => {
    let svc: SettingsService;

    setup(() => {
        svc = new SettingsService();
    });

    teardown(() => svc.dispose());

    test('default sopsPath is "sops"', () => {
        assert.strictEqual(svc.getSopsPath(), 'sops');
    });

    test('default timeout is 30000', () => {
        assert.strictEqual(svc.getTimeout(), 30000);
    });

    test('default openBehavior is showEncrypted', () => {
        assert.strictEqual(svc.getOpenBehavior(), 'showEncrypted');
    });

    test('default saveBehavior is manualEncrypt', () => {
        assert.strictEqual(svc.getSaveBehavior(), 'manualEncrypt');
    });

    test('default decryptedViewMode is preview', () => {
        assert.strictEqual(svc.getDecryptedViewMode(), 'preview');
        assert.strictEqual(svc.useEditInPlace(), false);
    });

    test('confirmation flags default to true', () => {
        assert.strictEqual(svc.shouldConfirmRotate(), true);
        assert.strictEqual(svc.shouldConfirmUpdateKeys(), true);
    });

    test('debug logging defaults to off', () => {
        assert.strictEqual(svc.isDebugLoggingEnabled(), false);
    });

    test('getTimeout clamps via direct config stub: NaN falls back to 30000', () => {
        // Reach into the cached config layer to simulate user-supplied junk.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (svc as any).cachedConfig = stubConfig({ decryptionTimeout: NaN });
        assert.strictEqual(svc.getTimeout(), 30000);
    });

    test('getTimeout clamps zero up to 1000ms', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (svc as any).cachedConfig = stubConfig({ decryptionTimeout: 0 });
        assert.strictEqual(svc.getTimeout(), 1000);
    });

    test('getTimeout clamps negative up to 1000ms', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (svc as any).cachedConfig = stubConfig({ decryptionTimeout: -5000 });
        assert.strictEqual(svc.getTimeout(), 1000);
    });

    test('getTimeout clamps very large values down to 600000ms', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (svc as any).cachedConfig = stubConfig({ decryptionTimeout: 9_999_999 });
        assert.strictEqual(svc.getTimeout(), 600000);
    });

    test('getTimeout passes through reasonable values unchanged', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (svc as any).cachedConfig = stubConfig({ decryptionTimeout: 45000 });
        assert.strictEqual(svc.getTimeout(), 45000);
    });
});

function stubConfig(values: Record<string, unknown>): vscode.WorkspaceConfiguration {
    return {
        get<T>(key: string, defaultValue?: T): T {
            return (key in values ? values[key] : defaultValue) as T;
        },
        has: (k: string) => k in values,
        inspect: () => undefined,
        update: async () => undefined
    } as unknown as vscode.WorkspaceConfiguration;
}

import * as vscode from 'vscode';
import { ConfigManager } from '../config/configManager';
import { SopsDetector } from '../sops/sopsDetector';
import { SopsRunner } from '../sops/sopsRunner';
import { SettingsService } from '../services/settingsService';
import { FileStateTracker } from '../state/fileStateTracker';
import { handleError } from '../utils/errorHandler';
import { getErrorMessage } from '../utils/errorUtils';

/**
 * Handles auto-decrypt on open and auto-encrypt on save behaviors.
 * Note: showDecrypted behavior is handled by DocumentWatcher.maybeUpdateDecryptedView
 */
export class AutoBehaviorHandler {
    constructor(
        private configManager: ConfigManager,
        private sopsDetector: SopsDetector,
        private sopsRunner: SopsRunner,
        private settingsService: SettingsService,
        private fileStateTracker: FileStateTracker
    ) {}

    /**
     * Handle document opened event - auto-decrypt based on settings.
     * Note: showDecrypted behavior is handled by DocumentWatcher.maybeUpdateDecryptedView
     * via onDidChangeActiveTextEditor, which properly manages closing old previews.
     */
    async handleDocumentOpened(doc: vscode.TextDocument): Promise<void> {
        if (doc.uri.scheme !== 'file') {
            return;
        }

        // Only handle autoDecrypt behavior here
        // showDecrypted is handled by DocumentWatcher.maybeUpdateDecryptedView
        if (this.settingsService.getOpenBehavior() !== 'autoDecrypt') {
            return;
        }

        // Check if file matches a SOPS rule and is encrypted
        if (!this.configManager.hasMatchingRule(doc.uri)) {
            return;
        }

        if (!this.sopsDetector.isDocumentEncrypted(doc)) {
            return;
        }

        await this.autoDecryptDocument(doc);
    }

    /**
     * Handle document will save event - auto-encrypt or prompt based on settings
     */
    handleDocumentWillSave(event: vscode.TextDocumentWillSaveEvent): void {
        if (event.document.uri.scheme !== 'file') {
            return;
        }

        // Check if this is a decrypted file
        if (!this.fileStateTracker.isMarkedDecrypted(event.document.uri)) {
            return;
        }

        const saveBehavior = this.settingsService.getSaveBehavior();

        switch (saveBehavior) {
            case 'autoEncrypt':
                event.waitUntil(this.autoEncrypt(event.document));
                break;

            case 'prompt':
                event.waitUntil(this.promptBeforeSave(event.document));
                break;

            case 'manualEncrypt':
            default:
                // Do nothing - user must manually encrypt
                break;
        }
    }

    /**
     * Mark a file as decrypted (called after successful decrypt operations)
     */
    markDecrypted(uri: vscode.Uri): void {
        this.fileStateTracker.markDecrypted(uri);
    }

    private async autoDecryptDocument(doc: vscode.TextDocument): Promise<void> {
        try {
            const decrypted = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Auto-decrypting file...',
                    cancellable: false
                },
                async () => {
                    return await this.sopsRunner.decrypt(doc.uri.fsPath);
                }
            );

            // Replace document content with decrypted content
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(doc.getText().length)
            );
            edit.replace(doc.uri, fullRange, decrypted);
            await vscode.workspace.applyEdit(edit);

            // Mark as decrypted for save behavior tracking
            this.fileStateTracker.markDecrypted(doc.uri);
        } catch (error) {
            // Show error but don't block - user can manually decrypt
            vscode.window.showWarningMessage(
                `Auto-decrypt failed: ${getErrorMessage(error)}. You can manually decrypt using the toolbar icon.`
            );
        }
    }

    private async autoEncrypt(doc: vscode.TextDocument): Promise<vscode.TextEdit[]> {
        const content = doc.getText();
        const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(content.length)
        );

        try {
            // Find the config file to use (supports both .sops.yaml and .sops.yml)
            const configPath = this.configManager.getConfigPath(doc.uri);

            const encrypted = await this.sopsRunner.encryptContent(
                content,
                doc.uri.fsPath,
                configPath ?? undefined
            );

            // Mark as encrypted AFTER successful encryption
            this.fileStateTracker.markEncrypted(doc.uri);

            return [vscode.TextEdit.replace(fullRange, encrypted)];
        } catch (error) {
            // State remains as decrypted on error
            handleError(error);

            // Encryption failed. VS Code cannot veto the save from within
            // willSaveWaitUntil, so if we return no edits the plaintext
            // buffer would overwrite the ciphertext on disk. Revert the
            // buffer to the on-disk ciphertext so the save is effectively
            // a no-op at the file level.
            try {
                const diskBytes = await vscode.workspace.fs.readFile(doc.uri);
                const diskContent = Buffer.from(diskBytes).toString('utf-8');
                vscode.window.showErrorMessage(
                    'Auto-encrypt failed. The saved file has been kept as its previous encrypted content to prevent plaintext exposure. Your in-memory edits are preserved only if you undo this save.'
                );
                return [vscode.TextEdit.replace(fullRange, diskContent)];
            } catch {
                // Could not read prior ciphertext (e.g., file was deleted).
                // Replace the buffer with an empty string so nothing
                // plaintext is persisted.
                vscode.window.showErrorMessage(
                    'Auto-encrypt failed and previous encrypted content could not be recovered. The file has been emptied to prevent plaintext exposure.'
                );
                return [vscode.TextEdit.replace(fullRange, '')];
            }
        }
    }

    private async promptBeforeSave(
        doc: vscode.TextDocument
    ): Promise<vscode.TextEdit[]> {
        const choice = await vscode.window.showWarningMessage(
            'This file is decrypted. How would you like to save?',
            { modal: true },
            'Encrypt & Save',
            'Save Without Encryption'
        );

        if (choice === 'Encrypt & Save') {
            return this.autoEncrypt(doc);
        }

        // Save without encryption
        return [];
    }
}

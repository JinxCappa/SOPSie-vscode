import * as vscode from 'vscode';
import * as YAML from 'yaml';
import { logger } from '../services/loggerService';
import { getErrorMessage } from '../utils/errorUtils';

/**
 * Detects if a file is SOPS-encrypted by checking for SOPS metadata
 */
export class SopsDetector {
    /**
     * Check if a file is SOPS-encrypted by looking for the sops metadata key.
     * SOPS-encrypted files always contain a "sops:" key with metadata including
     * mac, version, lastmodified, etc.
     */
    async isEncrypted(uri: vscode.Uri): Promise<boolean> {
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf-8');
            return this.isContentEncrypted(text);
        } catch (error) {
            logger.debug(`Failed to read file for encryption check ${uri.fsPath}: ${getErrorMessage(error)}`);
            return false;
        }
    }

    /**
     * Check if content string is SOPS-encrypted
     */
    isContentEncrypted(content: string): boolean {
        // Quick check: if no "sops" anywhere, not encrypted
        if (!content.includes('sops')) {
            return false;
        }

        // Binary format detection (rarely used)
        if (content.startsWith('SOPS')) {
            return true;
        }

        // ENV files have sops metadata as prefixed keys
        if (content.includes('sops_version=') || content.includes('sops_mac=')) {
            return true;
        }

        // INI files have sops metadata in a [sops] section with matching
        // metadata fields inside that section.
        if (/^\[sops\]\s*$/m.test(content)) {
            return SopsDetector.hasIniSopsMetadata(content);
        }

        // YAML/JSON: parse and verify a top-level `sops` mapping that
        // contains the required metadata subkeys. Flat regex matches
        // produced false positives when a file happened to have both a
        // `sops` key and an unrelated `version:` field elsewhere.
        return SopsDetector.hasYamlSopsMetadata(content);
    }

    private static hasYamlSopsMetadata(content: string): boolean {
        let parsed: unknown;
        try {
            parsed = YAML.parse(content);
        } catch {
            return false;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return false;
        }
        const sops = (parsed as Record<string, unknown>).sops;
        if (!sops || typeof sops !== 'object' || Array.isArray(sops)) {
            return false;
        }
        const meta = sops as Record<string, unknown>;
        // Require mac, which every SOPS-encrypted file carries, plus
        // at least one other metadata field.
        if (typeof meta.mac !== 'string') {
            return false;
        }
        return 'version' in meta || 'lastmodified' in meta;
    }

    private static hasIniSopsMetadata(content: string): boolean {
        const headerMatch = content.match(/^\[sops\]\s*$/m);
        if (!headerMatch || headerMatch.index === undefined) {
            return false;
        }
        const sectionStart = headerMatch.index + headerMatch[0].length;
        const nextSectionMatch = content.slice(sectionStart).search(/^\[/m);
        const sectionBody = nextSectionMatch === -1
            ? content.slice(sectionStart)
            : content.slice(sectionStart, sectionStart + nextSectionMatch);
        return /^mac\s*=/m.test(sectionBody) && /^version\s*=/m.test(sectionBody);
    }

    /**
     * Check if a document is SOPS-encrypted
     */
    isDocumentEncrypted(document: vscode.TextDocument): boolean {
        return this.isContentEncrypted(document.getText());
    }
}

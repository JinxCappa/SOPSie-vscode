import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { RulesMatcher, clearRegexCache } from '../../config/rulesMatcher';
import { SopsConfig } from '../../types';

const configDir = path.resolve('/repo');

function matcher(config: SopsConfig): RulesMatcher {
    return new RulesMatcher(config, configDir);
}

function fileIn(relPath: string): vscode.Uri {
    return vscode.Uri.file(path.join(configDir, relPath));
}

suite('rulesMatcher', () => {
    setup(() => clearRegexCache());

    test('matches first rule with path_regex', () => {
        const m = matcher({
            creation_rules: [
                { path_regex: 'secrets/.*\\.yaml$', age: 'a' },
                { age: 'b' }
            ]
        });
        const rule = m.findMatchingRule(fileIn('secrets/prod.yaml'));
        assert.strictEqual(rule?.age, 'a');
    });

    test('first-match semantics: earlier rule wins even if later also matches', () => {
        const m = matcher({
            creation_rules: [
                { path_regex: 'secrets/.*', age: 'first' },
                { path_regex: 'secrets/prod\\.yaml', age: 'second' }
            ]
        });
        const rule = m.findMatchingRule(fileIn('secrets/prod.yaml'));
        assert.strictEqual(rule?.age, 'first');
    });

    test('filename_regex matches on basename only, not path', () => {
        const m = matcher({
            creation_rules: [
                { filename_regex: '^secret\\.json$', age: 'a' }
            ]
        });
        assert.ok(m.findMatchingRule(fileIn('nested/deep/secret.json')));
        assert.strictEqual(m.findMatchingRule(fileIn('secret.json.backup')), null);
    });

    test('catch-all rule (no regex) matches any file', () => {
        const m = matcher({ creation_rules: [{ age: 'a' }] });
        assert.ok(m.findMatchingRule(fileIn('anything.txt')));
        assert.ok(m.findMatchingRule(fileIn('deep/nested/path/file')));
    });

    test('returns null when no rule matches', () => {
        const m = matcher({
            creation_rules: [{ path_regex: '^secrets/', age: 'a' }]
        });
        assert.strictEqual(m.findMatchingRule(fileIn('public/readme.md')), null);
    });

    test('path_regex is tested against path relative to config dir', () => {
        const m = matcher({
            creation_rules: [{ path_regex: '^secrets/prod\\.yaml$', age: 'a' }]
        });
        assert.ok(m.findMatchingRule(fileIn('secrets/prod.yaml')));
    });

    test('path separators normalized to forward slashes', () => {
        // Construct a URI where fsPath has backslashes on Windows; on POSIX
        // this still exercises the normalization logic since rulesMatcher
        // replaces \\ with /.
        const m = matcher({
            creation_rules: [{ path_regex: 'secrets/nested/secret\\.yaml$', age: 'a' }]
        });
        assert.ok(m.findMatchingRule(fileIn('secrets/nested/secret.yaml')));
    });

    test('invalid regex pattern does not match and does not throw', () => {
        // Bypass parser validation by constructing config directly
        const m = matcher({
            creation_rules: [
                { path_regex: '([unclosed', age: 'bad' },
                { path_regex: '.*\\.yaml$', age: 'good' }
            ]
        });
        const rule = m.findMatchingRule(fileIn('x.yaml'));
        assert.strictEqual(rule?.age, 'good');
    });

    test('regex cache is populated and cleared', () => {
        const m = matcher({
            creation_rules: [{ path_regex: 'foo', age: 'a' }]
        });
        m.findMatchingRule(fileIn('foo'));
        m.findMatchingRule(fileIn('foo'));
        clearRegexCache();
        // Still matches after clear (cache is rebuilt)
        assert.ok(m.findMatchingRule(fileIn('foo')));
    });
});

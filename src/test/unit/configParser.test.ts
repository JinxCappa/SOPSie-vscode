import * as assert from 'assert';
import { parseConfig } from '../../config/configParser';

suite('configParser', () => {
    test('parses valid config with path_regex', () => {
        const config = parseConfig(`creation_rules:
  - path_regex: secrets/.*\\.yaml$
    age: age1test
`);
        assert.strictEqual(config.creation_rules.length, 1);
        assert.strictEqual(config.creation_rules[0].path_regex, 'secrets/.*\\.yaml$');
        assert.strictEqual(config.creation_rules[0].age, 'age1test');
    });

    test('parses multiple rules preserving order', () => {
        const config = parseConfig(`creation_rules:
  - filename_regex: .*\\.secret\\.json$
    age: age1one
  - path_regex: secrets/.*
    age: age1two
  - age: age1catchall
`);
        assert.strictEqual(config.creation_rules.length, 3);
        assert.strictEqual(config.creation_rules[0].filename_regex, '.*\\.secret\\.json$');
        assert.strictEqual(config.creation_rules[1].path_regex, 'secrets/.*');
        assert.strictEqual(config.creation_rules[2].path_regex, undefined);
        assert.strictEqual(config.creation_rules[2].filename_regex, undefined);
    });

    test('parses key_groups with shamir_threshold', () => {
        const config = parseConfig(`creation_rules:
  - path_regex: .*
    shamir_threshold: 2
    key_groups:
      - age:
          - age1a
          - age1b
        pgp:
          - DEADBEEF
`);
        const rule = config.creation_rules[0];
        assert.strictEqual(rule.shamir_threshold, 2);
        assert.ok(rule.key_groups);
        assert.strictEqual(rule.key_groups!.length, 1);
    });

    test('throws on empty content', () => {
        assert.throws(() => parseConfig(''), /Empty or invalid YAML/);
    });

    test('throws on content without creation_rules', () => {
        assert.throws(
            () => parseConfig('destination_rules: []\n'),
            /Missing required "creation_rules"/
        );
    });

    test('throws when creation_rules is not an array', () => {
        assert.throws(
            () => parseConfig('creation_rules: not-a-list\n'),
            /"creation_rules" must be an array/
        );
    });

    test('throws on non-object rule entry', () => {
        assert.throws(
            () => parseConfig(`creation_rules:
  - "just a string"
`),
            /creation_rules\[0\] must be an object/
        );
    });

    test('throws when path_regex is not a string', () => {
        assert.throws(
            () => parseConfig(`creation_rules:
  - path_regex: 123
    age: age1test
`),
            /creation_rules\[0\]\.path_regex must be a string/
        );
    });

    test('throws on invalid path_regex', () => {
        assert.throws(
            () => parseConfig(`creation_rules:
  - path_regex: "([unclosed"
    age: age1test
`),
            /creation_rules\[0\]\.path_regex is invalid/
        );
    });

    test('throws on invalid filename_regex', () => {
        assert.throws(
            () => parseConfig(`creation_rules:
  - filename_regex: "*bad"
    age: age1test
`),
            /creation_rules\[0\]\.filename_regex is invalid/
        );
    });

    test('throws on malformed YAML', () => {
        assert.throws(() => parseConfig('creation_rules:\n  - path_regex: "unclosed\n'));
    });
});

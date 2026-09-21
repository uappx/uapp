import test from 'node:test'
import assert from 'node:assert/strict'
import stripJsonComments from '../src/stripJsonComments.js'

for (const whitespace of [true, false]) {
  test(`JSON comments preserve URLs, literal markers and escaped quotes (whitespace=${whitespace})`, () => {
    const expected = { url: 'https://example.test/a//b', markers: '/* literal */', quote: 'a"//b', backslashes: 'ends in \\', chinese: '中文' }
    const input = '// header\r\n' + JSON.stringify(expected, null, 2).replace('\n', '\n/* block\ncomment */\n') + '\n// eof'
    const stripped = stripJsonComments(input, { whitespace })
    assert.deepEqual(JSON.parse(stripped), expected)
    if (whitespace) {
      assert.equal(stripped.length, input.length)
      assert.deepEqual([...stripped.matchAll(/\r?\n/g)].map(match => match.index), [...input.matchAll(/\r?\n/g)].map(match => match.index))
    }
  })
}

test('trailing commas are opt-in and work before comments in nested arrays and objects', () => {
  const input = '{"values": [1, 2, /* comment */], "nested": {"text": ",]",},}'
  assert.throws(() => JSON.parse(stripJsonComments(input)), SyntaxError)
  for (const whitespace of [false, true]) {
    assert.deepEqual(JSON.parse(stripJsonComments(input, { trailingCommas: true, whitespace })), { values: [1, 2], nested: { text: ',]' } })
  }
})

test('invalid JSON is not silently repaired and non-string input is rejected', () => {
  assert.throws(() => JSON.parse(stripJsonComments('{"missing": } // comment')), SyntaxError)
  for (const input of [null, undefined, {}, 123]) assert.throws(() => stripJsonComments(input), TypeError)
})

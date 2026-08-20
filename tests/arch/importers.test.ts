import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { ChatStore } from '../../node/src/services/chat-store.ts';
import { parseChatGptExport } from '../../node/src/services/importers/chatgpt.ts';
import { parseClaudeExport } from '../../node/src/services/importers/claude.ts';
import { importChatExport } from '../../node/src/services/importers/index.ts';

const chatGptFixture = {
  conversations: [
    {
      id: 'conv-1',
      title: 'My conversation',
      create_time: 1690123456.789,
      mapping: {
        n1: {
          message: { author: { role: 'system' }, content: { content_type: 'text', parts: ['system prompt'] }, create_time: 1690123450 },
          parent: null,
          children: ['n2']
        },
        n2: {
          message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['hello'] }, create_time: 1690123455 },
          parent: 'n1',
          children: ['n3']
        },
        n3: {
          message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['hi there'] }, create_time: 1690123460 },
          parent: 'n2',
          children: ['n4', 'n5']
        },
        n4: {
          message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['what about the branch?'] }, create_time: 1690123465 },
          parent: 'n3',
          children: []
        },
        n5: {
          message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['this branch is abandoned'] }, create_time: 1690123466 },
          parent: 'n3',
          children: []
        }
      },
      current_node: 'n4'
    }
  ]
};

test('chatgpt parser linearizes only the current branch', () => {
  const result = parseChatGptExport(JSON.stringify(chatGptFixture));
  assert.equal(result.skipped, 0);
  assert.equal(result.conversations.length, 1);
  const conversation = result.conversations[0]!;
  assert.equal(conversation.title, 'My conversation');
  assert.deepEqual(
    conversation.messages.map(message => `${message.role}:${message.content}`),
    ['system:system prompt', 'user:hello', 'assistant:hi there', 'user:what about the branch?']
  );
  assert.ok(!JSON.stringify(conversation.messages).includes('abandoned'), 'non-active branch must not leak into the active one');
  assert.equal(conversation.updatedAt, 1690123465000);
});

test('chatgpt parser accepts the top-level array form and skips tool/empty messages', () => {
  const result = parseChatGptExport(
    JSON.stringify([
      {
        id: 'c2',
        mapping: {
          a: {
            message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['ping'] } },
            parent: null,
            children: []
          }
        },
        current_node: 'a'
      },
      {
        id: 'c3',
        mapping: {
          a: {
            message: { author: { role: 'tool' }, content: { content_type: 'text', parts: ['tool data'] } },
            parent: null,
            children: ['b']
          },
          b: { message: null, parent: 'a', children: [] }
        },
        current_node: 'b'
      }
    ])
  );
  assert.equal(result.conversations.length, 1, 'the all-tool/deleted conversation must be skipped');
  assert.equal(result.skipped, 1);
  assert.equal(result.conversations[0]!.messages[0]!.content, 'ping');
});

test('chatgpt parser rejects non-export JSON', () => {
  assert.throws(() => parseChatGptExport('{not json'), /not valid JSON/);
  assert.throws(() => parseChatGptExport('{"hello": 1}'), /missing "mapping"/);
});

test('claude parser maps human/assistant and drops thinking/tool blocks explicitly', () => {
  const fixture = {
    conversations: [
      {
        uuid: 'conv-a',
        name: 'Claude chat',
        chat_messages: [
          {
            uuid: 'm1',
            sender: 'human',
            content: [{ type: 'text', text: 'hello' }],
            created_at: '2024-01-01T00:00:00Z',
            parent_message_uuid: null
          },
          {
            uuid: 'm2',
            sender: 'assistant',
            content: [
              { type: 'thinking', thinking: 'let me reason' },
              { type: 'text', text: 'hi!' }
            ],
            created_at: '2024-01-01T00:00:01Z',
            parent_message_uuid: 'm1'
          },
          {
            uuid: 'm3',
            sender: 'assistant',
            content: [{ type: 'tool_use', id: 't1', name: 'calc', input: {} }],
            created_at: '2024-01-01T00:00:02Z',
            parent_message_uuid: 'm2'
          }
        ],
        current_leaf_message_uuid: 'm3'
      }
    ]
  };
  const result = parseClaudeExport(JSON.stringify(fixture));
  assert.equal(result.conversations.length, 1);
  const conversation = result.conversations[0]!;
  assert.deepEqual(
    conversation.messages.map(message => `${message.role}:${message.content}`),
    ['user:hello', 'assistant:hi!']
  );
  assert.ok(conversation.warnings.some(warning => warning.includes('thinking')), 'thinking blocks must be reported');
  assert.ok(conversation.warnings.some(warning => warning.includes('tool')), 'tool blocks must be reported');
  assert.equal(conversation.updatedAt, Date.parse('2024-01-01T00:00:00Z'));
});

test('claude parser rejects wrong shapes and accepts empty exports', () => {
  assert.throws(() => parseClaudeExport('[]'), /missing "conversations"/);
  assert.throws(() => parseClaudeExport('{"conversations": [{"uuid": "x"}]}'), /chat_messages/);
  const empty = parseClaudeExport('{"conversations": []}');
  assert.equal(empty.conversations.length, 0, 'a valid export with zero conversations imports zero');
});

test('import writes additive conversations into the chat store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-import-'));
  try {
    const store = new ChatStore(dir);
    const outcome = await importChatExport(store, 'chatgpt', JSON.stringify(chatGptFixture));
    assert.equal(outcome.imported, 1);
    assert.equal(outcome.skipped, 0);
    const listed = store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.modelId, 'import:chatgpt');
    assert.equal(listed[0]!.title, 'My conversation');
    assert.equal(listed[0]!.messages.length, 4);

    const second = await importChatExport(store, 'chatgpt', JSON.stringify(chatGptFixture));
    assert.equal(second.imported, 1, 're-import must be additive, never overwrite');
    const after = store.list();
    assert.equal(after.length, 2);
    assert.notEqual(after[0]!.id, after[1]!.id, 'new import gets a fresh id');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
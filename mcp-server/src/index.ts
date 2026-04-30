#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { buildServerTools } from './server-tools.js';

const tools = buildServerTools();
const toolsByName = new Map(tools.map((t) => [t.name, t] as const));

const server = new Server(
  { name: 'honeyllm-browse', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolsByName.get(request.params.name);
  if (!tool) {
    throw new Error(`unknown tool: ${request.params.name}`);
  }
  const args = (request.params.arguments ?? {}) as Readonly<Record<string, unknown>>;
  const result = await tool.handler(args);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Analyzer } from './types.js';
import { createMcpAnalyzer } from './stdio-analyzer.js';

export interface ConnectStdioMcpServerOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly toolName?: 'analyze_html' | 'analyze_url' | 'browse';
}

export interface StdioMcpConnection {
  readonly analyzer: Analyzer;
  readonly client: Client;
  readonly transport: StdioClientTransport;
}

export async function connectStdioMcpServer(
  opts: ConnectStdioMcpServerOptions,
): Promise<StdioMcpConnection> {
  const transport = new StdioClientTransport({
    command: opts.command,
    args: opts.args ? [...opts.args] : [],
    ...(opts.env !== undefined ? { env: { ...opts.env } } : {}),
  });
  const client = new Client(
    {
      name: opts.clientName ?? '@honeyllm/agent-sdk-vercel-ai',
      version: opts.clientVersion ?? '0.1.0',
    },
    { capabilities: {} },
  );
  await client.connect(transport);
  const analyzer = createMcpAnalyzer({
    client: { callTool: (params) => client.callTool(params) },
    ...(opts.toolName !== undefined ? { toolName: opts.toolName } : {}),
  });
  return { analyzer, client, transport };
}

export async function disconnectStdioMcpServer(conn: StdioMcpConnection): Promise<void> {
  await conn.client.close();
}

import {
  connectStdioMcpServer as coreConnectStdioMcpServer,
  disconnectStdioMcpServer as coreDisconnectStdioMcpServer,
  type ConnectStdioMcpServerOptions,
  type StdioMcpConnection,
} from '@honeyllm/agent-sdk-core';

export type { ConnectStdioMcpServerOptions, StdioMcpConnection };

const PACKAGE_CLIENT_NAME = '@honeyllm/agent-sdk-mastra';

export function connectStdioMcpServer(
  opts: ConnectStdioMcpServerOptions,
): Promise<StdioMcpConnection> {
  return coreConnectStdioMcpServer({
    ...opts,
    clientName: opts.clientName ?? PACKAGE_CLIENT_NAME,
  });
}

export function disconnectStdioMcpServer(
  conn: StdioMcpConnection,
): Promise<void> {
  return coreDisconnectStdioMcpServer(conn);
}

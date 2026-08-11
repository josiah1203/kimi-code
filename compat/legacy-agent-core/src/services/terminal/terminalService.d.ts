import { Disposable } from '../../di';
import type { CreateTerminalRequest, Terminal } from '@spiderbyte/protocol';
import { ISessionService } from '../session/session';
import { ITerminalService, type TerminalAttachOptions, type TerminalAttachSink, type TerminalBackend, type TerminalProcess, type TerminalServiceOptions, type TerminalSpawnOptions } from './terminal';
export declare class TerminalService extends Disposable implements ITerminalService {
    private readonly sessionService;
    readonly _serviceBrand: undefined;
    private readonly backend;
    private readonly defaultShell;
    private readonly defaultCols;
    private readonly defaultRows;
    private readonly maxBufferedFrames;
    private readonly records;
    constructor(options: TerminalServiceOptions | undefined, sessionService: ISessionService);
    create(sessionId: string, input: CreateTerminalRequest): Promise<Terminal>;
    list(sessionId: string): Promise<readonly Terminal[]>;
    get(sessionId: string, terminalId: string): Promise<Terminal>;
    attach(sessionId: string, terminalId: string, sink: TerminalAttachSink, options?: TerminalAttachOptions): Promise<{
        replayed: number;
    }>;
    detach(sessionId: string, terminalId: string, sinkId: string): void;
    detachAllForSink(sinkId: string): void;
    write(sessionId: string, terminalId: string, data: string): Promise<void>;
    resize(sessionId: string, terminalId: string, cols: number, rows: number): Promise<void>;
    close(sessionId: string, terminalId: string): Promise<{
        closed: true;
    }>;
    dispose(): void;
    private requireRecord;
    private onData;
    private onExit;
    private markExited;
    private pushFrame;
}
export declare class NodePtyTerminalBackend implements TerminalBackend {
    spawn(options: TerminalSpawnOptions): Promise<TerminalProcess>;
}

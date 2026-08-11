import { Disposable } from '../../di';
import type { FsBrowseResponse, FsHomeResponse } from '@spiderbyte/protocol';
import { IWorkspaceRegistry } from './workspaceRegistry';
import { IWorkspaceFsService } from './workspaceFs';
export declare class WorkspaceFsService extends Disposable implements IWorkspaceFsService {
    private readonly registry;
    readonly _serviceBrand: undefined;
    constructor(registry: IWorkspaceRegistry);
    browse(absPath?: string): Promise<FsBrowseResponse>;
    home(): Promise<FsHomeResponse>;
    dispose(): void;
}

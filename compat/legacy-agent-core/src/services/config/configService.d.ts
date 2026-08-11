import { Disposable } from '../../di';
import type { ConfigResponse, PatchConfigRequest } from '@spiderbyte/protocol';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IEventService } from '../event/event';
import { IConfigService } from './config';
export declare class ConfigService extends Disposable implements IConfigService {
    private readonly core;
    private readonly eventService;
    readonly _serviceBrand: undefined;
    constructor(core: ICoreProcessService, eventService: IEventService);
    get(): Promise<ConfigResponse>;
    set(patch: PatchConfigRequest): Promise<ConfigResponse>;
}

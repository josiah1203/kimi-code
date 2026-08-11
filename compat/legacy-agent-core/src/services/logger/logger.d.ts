export interface ILogService {
    readonly _serviceBrand: undefined;
    info(obj: object | string, msg?: string): void;
    warn(obj: object | string, msg?: string): void;
    error(obj: object | string, msg?: string): void;
    debug(obj: object | string, msg?: string): void;
    child(bindings: object): ILogService;
}
export declare const ILogService: import("../..").ServiceIdentifier<ILogService>;

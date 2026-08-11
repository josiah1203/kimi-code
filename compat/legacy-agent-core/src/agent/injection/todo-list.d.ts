import { DynamicInjector } from './injector';
export declare class TodoListReminderInjector extends DynamicInjector {
    protected readonly injectionVariant = "todo_list_reminder";
    protected getInjection(): string | undefined;
    private isTodoListActive;
    private currentTodos;
}

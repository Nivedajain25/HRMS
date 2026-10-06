import { body, query } from '../middleware/validate';
import * as todos from '../services/todo.service';
import { handle, handleCreated, idOf } from '../utils/controller';

export const todoController = {
  list: handle((ctx, req) => todos.listTodos(ctx, query<{ date: string }>(req))),
  create: handleCreated((ctx, req) => todos.createTodo(ctx, body<Parameters<typeof todos.createTodo>[1]>(req)), 'To-do added'),
  update: handle((ctx, req) => todos.updateTodo(ctx, idOf(req), body<Parameters<typeof todos.updateTodo>[2]>(req))),
  remove: handle((ctx, req) => todos.deleteTodo(ctx, idOf(req)), 'To-do deleted'),
  reorder: handle((ctx, req) => todos.reorderTodos(ctx, body<{ ids: string[] }>(req).ids)),
};

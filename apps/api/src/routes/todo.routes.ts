import { idParam, todoCreateSchema, todoListQuery, todoReorderSchema, todoUpdateSchema } from '@stencil/shared';
import { todoController as t } from '../controllers/todo.controller';
import { createModule } from './registry';

/** Personal to-dos (dashboard Todo card): every user sees and edits only their own. */
export const todoModule = createModule('Todos', '/api/v1/todos');
todoModule.route({ method: 'get', path: '/', summary: 'My to-dos for a day', query: todoListQuery }, t.list);
todoModule.route({ method: 'post', path: '/', summary: 'Add a to-do', body: todoCreateSchema }, t.create);
todoModule.route({ method: 'post', path: '/reorder', summary: 'Save a new order for a day’s to-dos', body: todoReorderSchema }, t.reorder);
todoModule.route({ method: 'patch', path: '/:id', summary: 'Tick / rename / recolour a to-do', params: idParam, body: todoUpdateSchema }, t.update);
todoModule.route({ method: 'delete', path: '/:id', summary: 'Delete a to-do', params: idParam }, t.remove);

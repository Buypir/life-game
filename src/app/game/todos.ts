import { addDays } from './progress';

/** Справа зі списку: разова, з необов'язковими датою, часом і нагадуванням. */
export interface Todo {
  id: string;
  title: string;
  /** YYYY-MM-DD або null — «колись». */
  date: string | null;
  /** HH:mm або null — без часу. */
  time: string | null;
  /** За скільки хвилин до події нагадати; null — без нагадування. */
  remindBefore: number | null;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
}

export interface TodoInput {
  title: string;
  date: string | null;
  time: string | null;
  remindBefore: number | null;
}

/** Досвід за виконану справу зі списку. */
export const TODO_XP = 10;

export const MAX_TITLE = 80;

export const REMIND_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Без нагадування' },
  { value: 0, label: 'У момент події' },
  { value: 5, label: 'За 5 хв' },
  { value: 10, label: 'За 10 хв' },
  { value: 15, label: 'За 15 хв' },
  { value: 30, label: 'За 30 хв' },
  { value: 60, label: 'За 1 год' },
  { value: 120, label: 'За 2 год' },
  { value: 180, label: 'За 3 год' },
  { value: 1440, label: 'За 1 день' },
];

const MONTHS = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
];
const WEEKDAYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function newTodoId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Нормалізує введені дані: обрізає назву, прибирає нагадування без часу. */
export function cleanInput(input: TodoInput): TodoInput | null {
  const title = input.title.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE);
  if (!title) return null;
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
  const time = date && input.time && /^\d{2}:\d{2}$/.test(input.time) ? input.time : null;
  const remindBefore =
    time && typeof input.remindBefore === 'number' && input.remindBefore >= 0
      ? Math.round(input.remindBefore)
      : null;
  return { title, date, time, remindBefore };
}

/** Момент події за місцевим часом телефона. */
export function eventDate(todo: Pick<Todo, 'date' | 'time'>): Date | null {
  if (!todo.date || !todo.time) return null;
  const [y, m, d] = todo.date.split('-').map(Number);
  const [hh, mm] = todo.time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

/** Коли надіслати сповіщення, або null, якщо нагадування немає. */
export function notifyAt(todo: Pick<Todo, 'date' | 'time' | 'remindBefore'>): Date | null {
  const at = eventDate(todo);
  if (!at || todo.remindBefore === null) return null;
  return new Date(at.getTime() - todo.remindBefore * 60_000);
}

/** «30 хв», «2 год», «1 день». */
export function durationLabel(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? 'день' : days < 5 ? 'дні' : 'днів'}`;
  }
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} год`;
  return `${minutes} хв`;
}

export function remindLabel(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes === 0) return 'у момент події';
  return `за ${durationLabel(minutes)}`;
}

/** «сьогодні», «завтра», «вчора» або «пт, 7 листопада». */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'сьогодні';
  if (date === addDays(today, 1)) return 'завтра';
  if (date === addDays(today, -1)) return 'вчора';
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const year = date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`;
  return `${weekday}, ${d} ${MONTHS[m - 1]}${year}`;
}

/** Підпис часу в рядку списку. */
export function whenLabel(todo: Todo, today: string, withDay: boolean): string {
  if (!todo.date) return '';
  const day = withDay ? dayLabel(todo.date, today) : '';
  if (!todo.time) return day;
  return day ? `${day} · ${todo.time}` : todo.time;
}

/** Текст сповіщення: «Сьогодні о 14:00 · через 30 хв». */
export function reminderBody(todo: Todo, today: string): string {
  const day = todo.date ? dayLabel(todo.date, today) : '';
  const when = `${day ? day[0].toUpperCase() + day.slice(1) + ' ' : ''}о ${todo.time}`;
  return todo.remindBefore
    ? `${when} · через ${durationLabel(todo.remindBefore)}`
    : `${when} · зараз`;
}

export interface TodoGroup {
  key: 'overdue' | 'today' | 'tomorrow' | 'later' | 'someday' | 'done';
  title: string;
  items: Todo[];
}

function compare(a: Todo, b: Todo): number {
  const ad = a.date ?? '9999-99-99';
  const bd = b.date ?? '9999-99-99';
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = a.time ?? '99:99';
  const bt = b.time ?? '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

/** Групи для екрана: прострочені, сьогодні, завтра, пізніше, колись, виконані. */
export function groupTodos(todos: Todo[], today: string, doneLimit = 15): TodoGroup[] {
  const tomorrow = addDays(today, 1);
  const open = todos.filter((t) => !t.done).sort(compare);
  const groups: TodoGroup[] = [
    {
      key: 'overdue',
      title: 'Прострочені',
      items: open.filter((t) => t.date !== null && t.date < today),
    },
    { key: 'today', title: 'Сьогодні', items: open.filter((t) => t.date === today) },
    { key: 'tomorrow', title: 'Завтра', items: open.filter((t) => t.date === tomorrow) },
    {
      key: 'later',
      title: 'Пізніше',
      items: open.filter((t) => t.date !== null && t.date > tomorrow),
    },
    { key: 'someday', title: 'Колись', items: open.filter((t) => t.date === null) },
    {
      key: 'done',
      title: 'Виконано',
      items: todos
        .filter((t) => t.done)
        .sort((a, b) => ((a.doneAt ?? '') < (b.doneAt ?? '') ? 1 : -1))
        .slice(0, doneLimit),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Відновлює список справ зі збереження, відкидаючи пошкоджені записи. */
export function parseTodos(raw: unknown): Todo[] {
  if (!Array.isArray(raw)) return [];
  const result: Todo[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Partial<Todo>;
    if (typeof t.id !== 'string' || !t.id || t.id.length > 40 || ids.has(t.id)) continue;
    const clean = cleanInput({
      title: typeof t.title === 'string' ? t.title : '',
      date: typeof t.date === 'string' ? t.date : null,
      time: typeof t.time === 'string' ? t.time : null,
      remindBefore: typeof t.remindBefore === 'number' ? t.remindBefore : null,
    });
    if (!clean) continue;
    ids.add(t.id);
    result.push({
      id: t.id,
      ...clean,
      done: t.done === true,
      doneAt: typeof t.doneAt === 'string' ? t.doneAt : null,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(0).toISOString(),
    });
  }
  return result;
}

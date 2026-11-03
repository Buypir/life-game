/** Анімація, яку програє герой, коли справу виконано. */
export type ActionKind = 'wake' | 'brush' | 'wash' | 'eat' | 'type' | 'study' | 'jacks' | 'sleep';

/** Місце в кімнаті, куди герой іде перед дією. */
export type Spot = 'bed' | 'desk' | 'sink';

export type StatKey = 'strength' | 'intellect' | 'energy' | 'discipline' | 'work';

export interface Task {
  id: string;
  title: string;
  /** Що робить герой, поки грає анімація («Герой чистить зуби»). */
  doing: string;
  /** Підпис після виконання («Герой почистив зуби»). */
  done: string;
  xp: number;
  action: ActionKind;
  spot: Spot;
  stat: StatKey;
}

export interface Quest {
  id: string;
  title: string;
  short: string;
  tasks: Task[];
}

/** Бонус за повністю виконаний квест. */
export const QUEST_BONUS_XP = 25;

export const QUESTS: Quest[] = [
  {
    id: 'morning',
    title: 'Ранок',
    short: 'Ранок',
    tasks: [
      {
        id: 'wake',
        title: 'Прокинутись',
        doing: 'Герой прокидається',
        done: 'Герой прокинувся',
        xp: 10,
        action: 'wake',
        spot: 'bed',
        stat: 'energy',
      },
      {
        id: 'brush',
        title: 'Почистити зуби',
        doing: 'Герой чистить зуби',
        done: 'Герой почистив зуби',
        xp: 15,
        action: 'brush',
        spot: 'sink',
        stat: 'energy',
      },
      {
        id: 'wash',
        title: 'Вмитись',
        doing: 'Герой вмивається',
        done: 'Герой вмився',
        xp: 10,
        action: 'wash',
        spot: 'sink',
        stat: 'energy',
      },
      {
        id: 'breakfast',
        title: 'Сніданок',
        doing: 'Герой снідає',
        done: 'Герой поснідав',
        xp: 20,
        action: 'eat',
        spot: 'desk',
        stat: 'energy',
      },
    ],
  },
  {
    id: 'work',
    title: 'Робота і навчання',
    short: 'Робота',
    tasks: [
      {
        id: 'work',
        title: 'Робочий блок',
        doing: 'Герой працює',
        done: 'Робочий блок закрито',
        xp: 30,
        action: 'type',
        spot: 'desk',
        stat: 'work',
      },
      {
        id: 'study',
        title: 'Навчання',
        doing: 'Герой вчиться',
        done: 'Герой повчився',
        xp: 25,
        action: 'study',
        spot: 'desk',
        stat: 'intellect',
      },
      {
        id: 'workout',
        title: 'Розминка',
        doing: 'Герой робить розминку',
        done: 'Розминку зроблено',
        xp: 20,
        action: 'jacks',
        spot: 'bed',
        stat: 'strength',
      },
    ],
  },
  {
    id: 'evening',
    title: 'Вечір',
    short: 'Вечір',
    tasks: [
      {
        id: 'dinner',
        title: 'Вечеря',
        doing: 'Герой вечеряє',
        done: 'Герой повечеряв',
        xp: 15,
        action: 'eat',
        spot: 'desk',
        stat: 'energy',
      },
      {
        id: 'brush-evening',
        title: 'Почистити зуби',
        doing: 'Герой чистить зуби перед сном',
        done: 'Зуби чисті, можна спати',
        xp: 15,
        action: 'brush',
        spot: 'sink',
        stat: 'energy',
      },
      {
        id: 'plan',
        title: 'План на завтра',
        doing: 'Герой планує завтрашній день',
        done: 'План на завтра готовий',
        xp: 10,
        action: 'study',
        spot: 'desk',
        stat: 'discipline',
      },
      {
        id: 'sleep',
        title: 'Лягти спати',
        doing: 'Герой лягає спати',
        done: 'Герой спить. Добраніч!',
        xp: 15,
        action: 'sleep',
        spot: 'bed',
        stat: 'energy',
      },
    ],
  },
];

export const STAT_LABELS: Record<StatKey, string> = {
  strength: 'Сила',
  intellect: 'Інтелект',
  energy: 'Енергія',
  discipline: 'Дисципліна',
  work: 'Робота',
};

export const STAT_ORDER: StatKey[] = ['strength', 'intellect', 'energy', 'discipline', 'work'];

const TASK_INDEX = new Map<string, { task: Task; quest: Quest }>();
for (const quest of QUESTS) {
  for (const task of quest.tasks) {
    TASK_INDEX.set(task.id, { task, quest });
  }
}

export function findTask(taskId: string): { task: Task; quest: Quest } | undefined {
  return TASK_INDEX.get(taskId);
}

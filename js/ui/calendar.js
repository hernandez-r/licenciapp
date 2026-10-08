import { addDays, toDateKey } from '../core/date-utils.js';

let instance;

export function createCalendar(element, { onSelect, onEventClick }) {
  instance = new FullCalendar.Calendar(element, {
    locale: 'es',
    firstDay: 1,
    initialView: 'dayGridMonth',
    height: 'auto',
    selectable: true,
    selectMirror: true,
    dayMaxEvents: 3,
    headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
    buttonText: { today: 'Hoy' },
    select(info) {
      onSelect(info.startStr, toDateKey(addDays(info.endStr, -1)));
      instance.unselect();
    },
    dateClick(info) { onSelect(info.dateStr, info.dateStr); },
    eventClick(info) {
      if (info.event.extendedProps.kind === 'license') onEventClick(info.event.id);
    }
  });
  instance.render();
  return instance;
}

export function updateCalendar(licenses, holidays, types) {
  if (!instance) return;
  const typeMap = new Map(types.map(item => [item.id, item]));
  const events = [
    ...holidays.map(item => ({
      id: `holiday-${item.id}`,
      title: item.name,
      start: item.date,
      allDay: true,
      display: 'background',
      backgroundColor: '#feecef',
      extendedProps: { kind: 'holiday' }
    })),
    ...licenses.map(item => ({
      id: item.id,
      title: `${item.status === 'cancelled' ? 'Cancelada · ' : ''}${typeMap.get(item.typeId)?.name || item.rulesSnapshot?.name || 'Licencia'}`,
      start: item.startDate,
      end: toDateKey(addDays(item.endDate, 1)),
      allDay: true,
      color: item.status === 'cancelled' ? '#aeb3bd' : (typeMap.get(item.typeId)?.color || item.rulesSnapshot?.color || '#315cf5'),
      classNames: item.status === 'cancelled' ? ['opacity-50'] : [],
      extendedProps: { kind: 'license' }
    }))
  ];
  instance.removeAllEvents();
  instance.addEventSource(events);
}

export function goToDate(date) {
  instance?.gotoDate(date);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function normalizeDateInput(value) {
  if (!value) return null;

  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Já em ISO ou ISO com hora
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }

  // dd/mm/yyyy
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const [, dd, mm, yyyy] = br;
    return `${yyyy}-${mm}-${dd}`;
  }

  // yyyy/mm/dd
  const slash = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slash) {
    const [, yyyy, mm, dd] = slash;
    return `${yyyy}-${mm}-${dd}`;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

function isDateBetween(dateStr, startStr, endStr) {
  if (!dateStr || !startStr || !endStr) return false;
  return dateStr >= startStr && dateStr <= endStr;
}

function getWeekday(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  return date.getDay(); // 0 dom, 6 sab
}

function isSaturday(dateStr) {
  return getWeekday(dateStr) === 6;
}

function isSunday(dateStr) {
  return getWeekday(dateStr) === 0;
}

function buildBlankTurn() {
  return {
    rubrica: '',
    ocorrencia: '',
    entrada: '',
    saida: '',
    abono: '',
  };
}

function applyRubricaBoth(dayItem, text) {
  dayItem.turno1.rubrica = text;
  dayItem.turno2.rubrica = text;
  dayItem.statusFinal = text;
}

function applyOccurrenceByTurn(dayItem, text, turno) {
  const turn = normalizeTurno(turno);

  if (turn === 'MANHA') {
    dayItem.turno1.ocorrencia = text;
  } else if (turn === 'TARDE') {
    dayItem.turno2.ocorrencia = text;
  } else {
    dayItem.turno1.ocorrencia = text;
    dayItem.turno2.ocorrencia = text;
  }

  if (!dayItem.statusFinal) {
    dayItem.statusFinal = text;
  }
}

function normalizeTurno(turno) {
  const t = normalizeText(turno);

  if (
    t === '1' ||
    t === 'M' ||
    t === 'MANHA' ||
    t === 'MATUTINO' ||
    t === 'MORNING'
  ) {
    return 'MANHA';
  }

  if (
    t === '2' ||
    t === 'T' ||
    t === 'TARDE' ||
    t === 'VESPERTINO' ||
    t === 'AFTERNOON'
  ) {
    return 'TARDE';
  }

  if (
    t === 'AMBOS' ||
    t === 'INTEGRAL' ||
    t === 'DIA TODO' ||
    t === 'MANHA/TARDE' ||
    t === 'TODOS'
  ) {
    return 'AMBOS';
  }

  return 'AMBOS';
}

function classifyEventType(tipo) {
  const t = normalizeText(tipo);

  if (t.includes('FERIADO')) return 'FERIADO';
  if (t.includes('PONTO FACULTATIVO')) return 'PONTO FACULTATIVO';
  if (t === 'PONTO') return 'PONTO FACULTATIVO';
  if (t.includes('FACULTATIVO')) return 'PONTO FACULTATIVO';
  if (t.includes('LEMBRETE')) return 'EVENTO';
  if (t.includes('EVENTO')) return 'EVENTO';

  return 'OUTRO';
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  normalizeText,
  normalizeDateInput,
  isDateBetween,
  isSaturday,
  isSunday,
  buildBlankTurn,
  applyRubricaBoth,
  applyOccurrenceByTurn,
  normalizeTurno,
  classifyEventType,
  safeArray,
};

#!/usr/bin/env node
// Проверка seed/demo-data.json по контракту /api/export.
// Без зависимостей: node seed/validate.mjs [путь к файлу]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] ?? resolve(here, 'demo-data.json'));

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

const isText = (v) => typeof v === 'string' && v.trim().length > 0;

let data;
try {
  data = JSON.parse(readFileSync(target, 'utf8'));
} catch (e) {
  console.error(`Не удалось прочитать ${target}: ${e.message}`);
  process.exit(1);
}

if (!data || typeof data !== 'object' || Array.isArray(data)) {
  fail('корень', 'ожидался объект');
  data = {};
}

if (data.version !== 1) fail('корень', `version должен быть 1, получено ${JSON.stringify(data.version)}`);

if (!isText(data.exported_at) || Number.isNaN(Date.parse(data.exported_at))) {
  fail('корень', 'exported_at должен быть непустой строкой с датой (ISO 8601)');
}

if (!Array.isArray(data.subjects) || data.subjects.length === 0) {
  fail('корень', 'subjects должен быть непустым массивом');
}

const subjects = Array.isArray(data.subjects) ? data.subjects : [];
const seenSubjects = new Set();
let ticketsTotal = 0;
let partsTotal = 0;

subjects.forEach((subject, si) => {
  const sw = `subjects[${si}]`;
  if (!subject || typeof subject !== 'object') return fail(sw, 'ожидался объект предмета');
  if (!isText(subject.name)) fail(sw, 'name пустой');
  else {
    const key = subject.name.trim().toLowerCase();
    if (seenSubjects.has(key)) fail(sw, `повтор предмета «${subject.name}»`);
    seenSubjects.add(key);
  }

  const tickets = Array.isArray(subject.tickets) ? subject.tickets : [];
  if (tickets.length === 0) fail(sw, 'tickets пустой');
  ticketsTotal += tickets.length;

  tickets.forEach((ticket, ti) => {
    const tw = `${sw}.tickets[${ti}]`;
    if (!ticket || typeof ticket !== 'object') return fail(tw, 'ожидался объект билета');
    if (!isText(ticket.title)) fail(tw, 'title пустой');
    if (!isText(ticket.question)) fail(tw, 'question пустой');

    const parts = Array.isArray(ticket.parts) ? ticket.parts : [];
    if (parts.length === 0) fail(tw, 'parts пустой');
    partsTotal += parts.length;

    const seenTitles = new Set();

    parts.forEach((part, pi) => {
      const pw = `${tw}.parts[${pi}]`;
      if (!part || typeof part !== 'object') return fail(pw, 'ожидался объект части');

      if (!isText(part.title)) fail(pw, 'title пустой');
      else {
        const key = part.title.trim().toLowerCase();
        if (seenTitles.has(key)) fail(pw, `повтор названия части «${part.title}» внутри билета`);
        seenTitles.add(key);
        if (/^\s*\d/.test(part.title)) fail(pw, `title не должен начинаться с номера: «${part.title}»`);
      }

      if (!isText(part.question)) fail(pw, 'question пустой');
      if (!isText(part.note)) fail(pw, 'note пустой (конспект обязателен)');
      else if (part.note.trim().length < 40) fail(pw, `note слишком короткий (${part.note.trim().length} симв.)`);

      const options = part.options;
      if (!Array.isArray(options)) {
        fail(pw, 'options должен быть массивом');
        return;
      }
      if (options.length < 3 || options.length > 4) {
        fail(pw, `options должен содержать 3–4 варианта, сейчас ${options.length}`);
      }

      const seenOptions = new Set();
      options.forEach((opt, oi) => {
        if (!isText(opt)) {
          fail(`${pw}.options[${oi}]`, 'пустой или не строковый вариант');
          return;
        }
        const key = opt.trim().toLowerCase().replace(/\s+/g, ' ');
        if (seenOptions.has(key)) fail(`${pw}.options[${oi}]`, `дубль варианта «${opt}»`);
        seenOptions.add(key);
      });

      if (!Number.isInteger(part.correct_index)) {
        fail(pw, `correct_index должен быть целым числом, сейчас ${JSON.stringify(part.correct_index)}`);
      } else if (part.correct_index < 0 || part.correct_index >= options.length) {
        fail(pw, `correct_index=${part.correct_index} вне диапазона 0..${options.length - 1}`);
      }
    });
  });
});

const lines = [
  `Файл: ${target}`,
  `Предметов: ${subjects.length}, билетов: ${ticketsTotal}, частей: ${partsTotal}`,
];
subjects.forEach((s) => {
  const tickets = Array.isArray(s?.tickets) ? s.tickets : [];
  const parts = tickets.reduce((n, t) => n + (Array.isArray(t?.parts) ? t.parts.length : 0), 0);
  lines.push(`  — ${s?.name ?? '?'}: билетов ${tickets.length}, частей ${parts}`);
});

if (errors.length === 0) {
  lines.push(`OK: ошибок нет`);
  console.log(lines.join('\n'));
  process.exit(0);
}

lines.push(`ОШИБКИ (${errors.length}):`);
errors.forEach((e) => lines.push(`  ! ${e}`));
console.log(lines.join('\n'));
process.exit(1);

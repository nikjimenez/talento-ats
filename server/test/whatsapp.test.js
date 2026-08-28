/**
 * test/whatsapp.test.js — number normalisation and template rendering.
 *
 * These are the two functions that run on every message regardless of
 * whether WHATSAPP_TOKEN is set: get the destination number wrong and the
 * Meta API silently drops the send, or worse, texts a stranger.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as wa from '../services/whatsapp.js';

test('normalizarNumero: a bare 10-digit Colombian mobile gets the 57 country code', () => {
  assert.equal(wa.normalizarNumero('3104821176'), '573104821176');
});

test('normalizarNumero: accepts common separators', () => {
  assert.equal(wa.normalizarNumero('310 482 1176'), '573104821176');
  assert.equal(wa.normalizarNumero('310-482-1176'), '573104821176');
});

test('normalizarNumero: already-prefixed numbers pass through', () => {
  assert.equal(wa.normalizarNumero('573104821176'), '573104821176');
  assert.equal(wa.normalizarNumero('0573104821176'), '573104821176');
});

test('normalizarNumero: rejects a landline (does not start with 3)', () => {
  assert.equal(wa.normalizarNumero('6012345678'), null);
});

test('normalizarNumero: rejects the wrong number of digits', () => {
  assert.equal(wa.normalizarNumero('31048211'), null);
  assert.equal(wa.normalizarNumero(''), null);
  assert.equal(wa.normalizarNumero(null), null);
});

test('previsualizar: fills in every variable of a real approved template', () => {
  const texto = wa.previsualizar('entrevista_agendada', {
    nombre: 'Andrea', cargo: 'Asesor de servicio', fecha: '3 de septiembre',
    hora: '10:00 a. m.', modalidad: 'Google Meet'
  });
  assert.match(texto, /Andrea/);
  assert.match(texto, /Asesor de servicio/);
  assert.doesNotMatch(texto, /\{\{/, 'no placeholder should survive substitution');
});

test('previsualizar: leaves unfilled variables visibly marked, not silently blank', () => {
  const texto = wa.previsualizar('entrevista_agendada', { nombre: 'Andrea' });
  assert.match(texto, /\{\{cargo\}\}/);
});

test('previsualizar: returns null for a template that was never approved', () => {
  assert.equal(wa.previsualizar('plantilla_inventada', {}), null);
});

test('PLANTILLAS: every declared template lists a var for every {{placeholder}} in its own text', () => {
  for (const [id, p] of Object.entries(wa.PLANTILLAS)) {
    const placeholders = [...p.texto.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    for (const ph of placeholders) {
      assert.ok(p.vars.includes(ph), `template "${id}" uses {{${ph}}} but does not declare it in vars`);
    }
  }
});

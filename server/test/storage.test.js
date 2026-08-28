/**
 * test/storage.test.js — services/storage.js file validation, the actual
 * gate every resume and document upload passes through.
 *
 * These use real file signature bytes, not fixtures on disk: the whole
 * point of `validar` is that it reads the first bytes of the buffer
 * instead of trusting the declared MIME type or the file name.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../services/storage.js';

const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // docx is a zip
const NOT_A_REAL_FILE = Buffer.from('this is plain text, not a document');

test('validar: accepts a real PDF declared as one', () => {
  assert.equal(
    storage.validar({ buffer: PDF_HEADER, mimeDeclarado: 'application/pdf', nombre: 'resume.pdf' }),
    true
  );
});

test('validar: accepts a real legacy .doc (OLE2 signature)', () => {
  const OLE2_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.equal(
    storage.validar({ buffer: OLE2_HEADER, mimeDeclarado: 'application/msword', nombre: 'resume.doc' }),
    true
  );
});

test('validar: accepts a real DOCX (zip signature + wordprocessingml mime)', () => {
  assert.equal(
    storage.validar({
      buffer: ZIP_HEADER,
      mimeDeclarado: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      nombre: 'resume.docx'
    }),
    true
  );
});

test('validar: rejects an empty buffer', () => {
  assert.throws(
    () => storage.validar({ buffer: Buffer.alloc(0), mimeDeclarado: 'application/pdf', nombre: 'x.pdf' }),
    /empty/
  );
});

test('validar: rejects a file larger than the 10 MB limit', () => {
  const huge = Buffer.alloc(storage.LIMITES.maxBytes + 1);
  PDF_HEADER.copy(huge);
  assert.throws(
    () => storage.validar({ buffer: huge, mimeDeclarado: 'application/pdf', nombre: 'x.pdf' }),
    (err) => err.code === 'muy_grande'
  );
});

test('validar: rejects a MIME type not on the allow-list', () => {
  assert.throws(
    () => storage.validar({
      buffer: Buffer.from('#!/bin/sh\necho hi'),
      mimeDeclarado: 'application/x-sh',
      nombre: 'x.sh'
    }),
    (err) => err.code === 'formato'
  );
});

test('validar: rejects a PNG whose bytes do not match its declared PDF type — the actual defence against a renamed file', () => {
  assert.throws(
    () => storage.validar({ buffer: PNG_HEADER, mimeDeclarado: 'application/pdf', nombre: 'fake.pdf' }),
    (err) => err.code === 'contenido'
  );
});

test('validar: rejects text with no real file signature masquerading as a PDF', () => {
  assert.throws(
    () => storage.validar({ buffer: NOT_A_REAL_FILE, mimeDeclarado: 'application/pdf', nombre: 'x.pdf' })
  );
});

test('validar: rejects a double-extension file name (cv.pdf.exe)', () => {
  assert.throws(
    () => storage.validar({ buffer: PDF_HEADER, mimeDeclarado: 'application/pdf', nombre: 'cv.pdf.exe' }),
    (err) => err.code === 'nombre'
  );
});

test('firmar + verificar: a signed link round-trips and carries the right key and user', () => {
  const token = storage.firmar('2026/some-opaque-key.pdf', 42);
  const out = storage.verificar(token);
  assert.deepEqual(out, { clave: '2026/some-opaque-key.pdf', userId: 42 });
});

test('verificar: rejects a tampered token', () => {
  const token = storage.firmar('2026/some-opaque-key.pdf', 42);
  const tampered = token.slice(0, -2) + 'xx';
  assert.equal(storage.verificar(tampered), null);
});

test('verificar: rejects garbage input without throwing', () => {
  assert.equal(storage.verificar('not-a-real-token'), null);
  assert.equal(storage.verificar(''), null);
  assert.equal(storage.verificar(undefined), null);
});

/* Regression: the file-serving route served every document as
   application/octet-stream regardless of what it actually was, which
   makes every browser download instead of display it — the resume
   viewer's iframe never rendered anything, silently. */
test('mimePorExtension: recovers the real MIME from the stored file extension', () => {
  assert.equal(storage.mimePorExtension('.pdf'), 'application/pdf');
  assert.equal(storage.mimePorExtension('.jpg'), 'image/jpeg');
  assert.equal(storage.mimePorExtension('.png'), 'image/png');
  assert.equal(storage.mimePorExtension('.doc'), 'application/msword');
  assert.equal(storage.mimePorExtension('.docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

test('mimePorExtension: an unrecognised extension falls back to a safe default, not a throw', () => {
  assert.equal(storage.mimePorExtension('.exe'), 'application/octet-stream');
  assert.equal(storage.mimePorExtension(''), 'application/octet-stream');
});

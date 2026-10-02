import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.tsx';
import { api, newId, ApiError } from '../api.ts';
import type { Note, NoteScope } from '../../shared/types.ts';

type Status = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

/**
 * Autosaving plain-text note. Unsaved text is mirrored to localStorage so a network error or
 * reload never loses it; errors show a visible Retry.
 */
export function NoteEditor({ scope, noteKey, placeholder, rows = 4, autoFocus }: { scope: NoteScope; noteKey: string; placeholder?: string; rows?: number; autoFocus?: boolean }) {
  const s = useStore();
  const note = s.data.notes.find((n) => n.scope === scope && n.key === noteKey);
  const draftKey = `bac-draft-note:${s.me.user.id}:${scope}:${noteKey}`;
  const readDraft = () => {
    try {
      return localStorage.getItem(draftKey);
    } catch {
      return null;
    }
  };
  const [text, setText] = useState(() => readDraft() ?? note?.body ?? '');
  const [status, setStatus] = useState<Status>(readDraft() !== null && readDraft() !== (note?.body ?? '') ? 'error' : 'idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;
  const dirty = useRef(false);

  // Switching dates loads that day's note (or the local draft if one survived an error).
  useEffect(() => {
    const draft = readDraft();
    setText(draft ?? noteRef.current?.body ?? '');
    setStatus(draft !== null && draft !== (noteRef.current?.body ?? '') ? 'error' : 'idle');
    dirty.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey, scope]);

  // Pick up changes from other devices when not editing.
  useEffect(() => {
    if (!dirty.current && note && note.body !== text && status !== 'error') setText(note.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.version]);

  const save = async (body: string) => {
    setStatus('saving');
    const cur = noteRef.current;
    const payload: Note = cur
      ? { ...cur, body }
      : { id: newId(), ownerId: s.me.user.id, scope, key: noteKey, title: '', body, version: 0, updatedAt: '' };
    try {
      const saved = await api<Note>('PUT', `/api/notes/${payload.id}`, payload);
      s.patchData((d) => ({ ...d, notes: [saved, ...d.notes.filter((n) => n.id !== saved.id)] }));
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      dirty.current = false;
      setStatus('saved');
    } catch (e) {
      setStatus((e as ApiError).status === 409 ? 'conflict' : 'error');
    }
  };

  const onChange = (v: string) => {
    setText(v);
    dirty.current = true;
    try {
      localStorage.setItem(draftKey, v);
    } catch {
      /* ignore */
    }
    setStatus('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(v), 800);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div className="note-editor">
      <textarea
        value={text}
        rows={rows}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (dirty.current && timer.current) {
            clearTimeout(timer.current);
            void save(text);
          }
        }}
        aria-label={placeholder ?? 'Note'}
      />
      <div className="note-status" role="status">
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Saved · private to you'}
        {status === 'error' && (
          <>
            <span className="error-text">Not saved (kept on this device).</span> <button className="link" onClick={() => void save(text)}>Retry</button>
          </>
        )}
        {status === 'conflict' && (
          <>
            <span className="error-text">Changed on another device. Your text is kept here.</span>{' '}
            <button className="link" onClick={async () => { await s.reload(); setStatus('idle'); }}>Load latest</button>{' '}
            <button className="link" onClick={async () => { await s.reload(); setTimeout(() => void save(text), 50); }}>Keep mine</button>
          </>
        )}
      </div>
    </div>
  );
}

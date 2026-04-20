import { useRef, useState, useCallback } from 'react';
import { Annotation } from '../types';

export type UndoEntry =
  | { kind: 'create'; annotationId: string; snapshot: Annotation }
  | { kind: 'delete'; annotationId: string; snapshot: Annotation }
  | { kind: 'update'; annotationId: string; before: Annotation; after: Annotation };

const MAX_STACK_DEPTH = 50;

export function useAnnotationHistory() {
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  // Revision counter forces re-renders when stacks change
  const [, setRevision] = useState(0);
  const bump = useCallback(() => setRevision(r => r + 1), []);

  const pushOperation = useCallback((entry: UndoEntry) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > MAX_STACK_DEPTH) {
      undoStack.current.shift();
    }
    // New operation clears redo stack
    redoStack.current = [];
    bump();
  }, [bump]);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  const popUndo = useCallback((): UndoEntry | undefined => {
    const entry = undoStack.current.pop();
    if (entry) {
      redoStack.current.push(entry);
      if (redoStack.current.length > MAX_STACK_DEPTH) {
        redoStack.current.shift();
      }
      bump();
    }
    return entry;
  }, [bump]);

  const popRedo = useCallback((): UndoEntry | undefined => {
    const entry = redoStack.current.pop();
    if (entry) {
      undoStack.current.push(entry);
      if (undoStack.current.length > MAX_STACK_DEPTH) {
        undoStack.current.shift();
      }
      bump();
    }
    return entry;
  }, [bump]);

  const clearStacks = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    bump();
  }, [bump]);

  return { pushOperation, popUndo, popRedo, canUndo, canRedo, clearStacks };
}

import type { EditState } from '../../lib/state';

export interface PanelProps {
  st: EditState;
  update: (fn: (s: EditState) => EditState) => void;
  preview: (fn: (s: EditState) => EditState) => void;
  commit: () => void;
}

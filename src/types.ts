export type Mode = 'original' | 'fit' | 'fill' | 'auto' | 'stretch' | 'elastic' | 'ambient';
export interface Borders {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface PictureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Capabilities {
  pixels: 'unknown' | 'readable' | 'blocked';
  webgl: boolean;
  svg: 'experimental' | 'unavailable';
  fullscreen: boolean;
  elasticFailed: boolean;
  reason: string;
}
export interface FitSettings {
  mode: Mode;
  cropBudget: number;
  zoom: number;
  panX: number;
  panY: number;
  aspect: number;
  rotation: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
  borders: Borders;
  detectBars: boolean;
  lockBars: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  speed: number;
  center: number;
  strength: number;
  ambientBrightness: number;
  ambientBlur: number;
  ambientSpread: number;
  ambientSmoothing: number;
  ambientQuality: number;
  ambientFps: number;
  elasticBackend: 'webgl' | 'svg';
}
export interface PlayerAdapter {
  name: string;
  shell: HTMLElement;
  video: HTMLVideoElement;
}
export interface RenderPlan {
  mode: Mode;
  requestedMode: Mode;
  picture: PictureBounds;
  loss: number;
  x: number;
  y: number;
  width: number;
  height: number;
  viewport: { width: number; height: number };
  quarter: boolean;
  ambient: boolean;
  elastic: null | {
    sourceWidth: number;
    width: number;
    k: number;
    maxExpansion: number;
    forward: (x: number) => number;
    inverse: (x: number) => number;
  };
}
export interface SettingsStore {
  version: 1;
  global: FitSettings;
  sites: Record<string, Partial<FitSettings>>;
  disabled: string[];
}
export interface VideoSession {
  video: HTMLVideoElement;
  settings: FitSettings;
  capabilities: Capabilities;
  update: (patch: Partial<FitSettings>) => void;
  destroy: () => void;
}
export interface SessionStatus {
  active: boolean;
  adapter: string;
  settings: FitSettings;
  capabilities: Capabilities;
  effectiveMode: Mode;
  picture: PictureBounds | null;
  ambientActive: boolean;
  elasticUnavailable: boolean;
  speedUnsupported: boolean;
  notice: string;
  loss: number | null;
  message: string;
}

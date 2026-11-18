/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { secondsToFrames } from "@plan.video/runtime";

export const RULER_INTERVALS = [
  {
    numerator: secondsToFrames(600),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(300),
    denominator: 5,
  },
  {
    numerator: secondsToFrames(120),
    denominator: 4,
  },
  {
    numerator: secondsToFrames(60),
    denominator: 6,
  },
  {
    numerator: secondsToFrames(30),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(10),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(5),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(3),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(2),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(1),
    denominator: 10,
  },
  {
    numerator: 15,
    denominator: 5,
  },
  {
    numerator: 10,
    denominator: 10,
  },
  {
    numerator: 5,
    denominator: 5,
  },
];

export type TimelineColors = {
  background: { default: string; muted: string; accent: string };
  border: { darker: string; input: string; ring: string; playhead: string; scrubber: string };
  ruler: { tick: string; major: string; text: string };
  keyframe: string;
  clip: Record<'group' | 'video' | 'audio' | 'caption' | 'image' | 'text' | 'shape' | 'scene' | 'mask' | 'adjustment' | 'html' | 'failed', {
    background: string;
    foreground: string;
    border: string;
    primary?: string;
  }> & Record<'group' | 'video' | 'audio' | 'caption' | 'scene', { primary: string }>;
};

export const COLORS = {
  background: {
    default: '#1C1D1F',
    muted: '#27282A',
    accent: '#27282A',
  },
  border: {
    darker: '#1C1D1F',
    input: '#3D3E40',
    ring: '#2f6ff0',
    playhead: '#2f6ff0',
    scrubber: '#F43535',
  },
  ruler: {
    tick: 'rgba(255, 255, 255, 0.12)',
    major: 'rgba(255, 255, 255, 0.28)',
    text: 'rgba(255, 255, 255, 0.56)',
  },
  keyframe: 'rgba(237, 237, 237, 0.64)',
  // Every kind shares one lightness per role, so no clip outweighs another: fills 0.44, borders 0.58, labels 0.975 (OKLCH).
  clip: {
    group: {
      background: '#34383F',
      border: '#565B64',
      primary: '#50555E',
      foreground: '#EBEFF4',
    },
    video: {
      background: '#355187',
      border: '#5078C4',
      primary: '#B9D2FF', // Waveform
      foreground: '#F2F7FF', // Label
    },
    audio: {
      background: '#126147',
      border: '#208F69',
      primary: '#88E8BF',
      foreground: '#ECFBF4',
    },
    caption: {
      background: '#783A5A',
      border: '#B05885',
      primary: '#AF4D80', // Word background
      foreground: '#FFF3F8',
    },
    image: {
      background: '#6E4B0F',
      border: '#A16F1C',
      foreground: '#FEF5EA',
    },
    text: {
      background: '#415566',
      border: '#627E96',
      foreground: '#F2F7FC',
    },
    shape: {
      background: '#7B4028',
      border: '#B4603E',
      foreground: '#FFF4F0',
    },
    scene: {
      background: '#005D6D',
      border: '#0089A0',
      primary: '#7BE2FB',
      foreground: '#EBFAFE',
    },
    mask: {
      background: '#494B86',
      border: '#6D70C2',
      foreground: '#F5F6FF',
    },
    adjustment: {
      background: '#5B457F',
      border: '#8667B9',
      foreground: '#F8F5FF',
    },
    html: {
      background: '#00605C',
      border: '#018D87',
      foreground: '#EBFAF9',
    },
    failed: {
      background: '#4A2420',
      border: '#A83634',
      foreground: '#FFA09C',
    },
  },
} satisfies TimelineColors;

export const LIGHT_COLORS = {
  background: {
    default: '#FFFFFF',
    muted: '#EDEDED',
    accent: '#F3F3F3',
  },
  border: {
    darker: '#FFFFFF',
    input: '#D4D4D4',
    ring: '#2563eb',
    playhead: '#2563eb',
    scrubber: '#E5252A',
  },
  ruler: {
    tick: 'rgba(0, 0, 0, 0.14)',
    major: 'rgba(0, 0, 0, 0.3)',
    text: 'rgba(0, 0, 0, 0.5)',
  },
  keyframe: 'rgba(0, 0, 0, 0.5)',
  clip: {
    group: {
      background: '#ECEEF1',
      border: '#D3D8DE',
      primary: '#C9CFD6',
      foreground: '#3B434D',
    },
    video: {
      background: '#E5EDFD',
      border: '#BBCFF8',
      primary: '#5B8DEF',
      foreground: '#1D4ED8',
    },
    audio: {
      background: '#DDF6EC',
      border: '#A9E5CF',
      primary: '#16A97C',
      foreground: '#067352',
    },
    caption: {
      background: '#FAE4F0',
      border: '#EFBDD9',
      primary: '#EDB6D6',
      foreground: '#9D1F6B',
    },
    image: {
      background: '#FCEDDD',
      border: '#F3CFA8',
      foreground: '#9A4B08',
    },
    text: {
      background: '#EDF0F4',
      border: '#D2D9E2',
      foreground: '#3D4E63',
    },
    shape: {
      background: '#FAE6DF',
      border: '#F2C6B5',
      foreground: '#9B3B08',
    },
    scene: {
      background: '#DFF3F9',
      border: '#ABDDEC',
      primary: '#7CC3DE',
      foreground: '#055A79',
    },
    mask: {
      background: '#E9E9FC',
      border: '#C9CAF5',
      foreground: '#4041C9',
    },
    adjustment: {
      background: '#ECE6FB',
      border: '#D1C3F4',
      foreground: '#4827B0',
    },
    html: {
      background: '#E3F0F4',
      border: '#BCD9E2',
      foreground: '#24505E',
    },
    failed: {
      background: '#FDECEC',
      border: '#F5C2C2',
      foreground: '#C81E1E',
    },
  },
} satisfies TimelineColors;

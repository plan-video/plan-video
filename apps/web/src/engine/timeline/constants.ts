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

// window.getComputedStyle(document.body).getPropertyValue('--background')

export type TimelineColors = {
  background: { default: string; muted: string; accent: string };
  border: { darker: string; input: string; ring: string; scrubber: string };
  ruler: { tick: string; text: string };
  keyframe: string;
  clip: Record<'group' | 'video' | 'audio' | 'caption' | 'image' | 'text' | 'shape' | 'scene' | 'mask' | 'adjustment' | 'html' | 'failed', {
    background: string;
    foreground: string;
    /** The hairline just inside the clip's edge, in its own colour. */
    border: string;
    primary?: string;
  }> & Record<'group' | 'video' | 'audio' | 'caption' | 'scene', { primary: string }>;
};

/**
 * The dark theme's timeline: each clip a quiet tint of its colour over the
 * panel, edged in a stronger line of it, with the label and the waveform in
 * a light shade of the same hue. Selection is the one blue ring.
 */
export const COLORS = {
  background: {
    default: '#0B0B0B',
    muted: '#161616',
    accent: '#161616',
  },
  border: {
    darker: '#0B0B0B',
    input: '#2E2E2E',
    ring: '#2f6ff0',
    scrubber: '#F43535', // ambient red
  },
  ruler: {
    tick: 'rgba(255, 255, 255, 0.1)',
    text: 'rgba(255, 255, 255, 0.36)',
  },
  keyframe: 'rgba(237, 237, 237, 0.64)',
  clip: {
    group: {
      background: '#202227',
      border: '#363A42',
      primary: '#3A3F47',
      foreground: '#E5E7EB',
    },
    video: {
      background: '#1A2A4A',
      border: '#2A4785',
      primary: '#7AA7F7', // Waveform
      foreground: '#D6E4FF', // Label
    },
    audio: {
      background: '#143C2F',
      border: '#17664A',
      primary: '#34D399',
      foreground: '#C9F5E3',
    },
    caption: {
      background: '#45213A',
      border: '#7A2F5C',
      primary: '#8E3566', // Word background
      foreground: '#FBD5E8',
    },
    image: {
      background: '#463415',
      border: '#7A5516',
      foreground: '#FDE8C4',
    },
    text: {
      background: '#2E3239',
      border: '#4B525D',
      foreground: '#E2E8F0',
    },
    shape: {
      background: '#452222',
      border: '#782D2D',
      foreground: '#FDE2E2',
    },
    scene: {
      background: '#123A42',
      border: '#126170',
      primary: '#22D3EE',
      foreground: '#CFF7FD',
    },
    mask: {
      background: '#282A4A',
      border: '#3F417F',
      foreground: '#E0E1FD',
    },
    adjustment: {
      background: '#30274A',
      border: '#513A82',
      foreground: '#ECE4FE',
    },
    html: {
      background: '#163B37',
      border: '#17635B',
      foreground: '#CCF5EF',
    },
    failed: {
      background: '#2A1616',
      border: '#5C2424',
      foreground: '#FF8A8A',
    },
  },
} satisfies TimelineColors;

/**
 * The light theme's timeline: clips in a pale wash of their colour, edged
 * a step darker, with the label and waveform in its full strength, on white
 * rows.
 */
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
    scrubber: '#E5252A',
  },
  ruler: {
    tick: 'rgba(0, 0, 0, 0.12)',
    text: 'rgba(0, 0, 0, 0.42)',
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
      background: '#FBE7E4',
      border: '#F1C3BC',
      foreground: '#A3301F',
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

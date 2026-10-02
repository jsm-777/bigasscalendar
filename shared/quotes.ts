import type { ISODate } from './types.ts';

// Original affirmations written for this app — no author attribution is claimed.
// The daily choice is a stable hash of the user's local date.
export const AFFIRMATIONS: string[] = [
  'You do not have to remember everything. That is what the board is for.',
  'One planned step beats ten floating intentions.',
  'Progress counts even when it is quiet.',
  'Rest on purpose is still part of the plan.',
  'A small win today is a real win.',
  'Start where you are; adjust as you go.',
  'Look at the whole year, then pick the next hour.',
  'Consistency grows from showing up, not from perfect days.',
  'If it matters, give it a time and a place.',
  'Done for today can be enough.',
  'Make the next action obvious and the rest gets easier.',
  'A missed day is information, not a verdict.',
  'Protect the time that protects your goals.',
  'You are allowed to plan gently.',
  'Practice is the point; results follow practice.',
  'Clear the small things so the big things have room.',
  'Write it down and let your mind rest.',
  'Every week is a fresh set of chances.',
  'Notice what worked and do more of it.',
  'Slow progress is still forward.',
  'The plan serves you, not the other way around.',
  'Be specific with your time and kind with yourself.',
  'Show up for ten minutes; momentum can do the rest.',
  'Today only needs today’s effort.',
  'Finish one thing before starting the next.',
  'Celebrate the check-in, not just the streak.',
  'Your future self will thank you for the reminder you set now.',
  'Make space for what restores you.',
  'Reflection turns experience into skill.',
  'Small, steady, and seen: that is how big things get built.',
  'It is okay to move a plan. It is better than dropping it.',
];

export function hashDate(date: ISODate): number {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function affirmationFor(date: ISODate): string {
  return AFFIRMATIONS[hashDate(date) % AFFIRMATIONS.length];
}

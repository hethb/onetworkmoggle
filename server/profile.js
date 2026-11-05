import { z } from 'zod';
import { INDUSTRIES } from './taxonomy.js';

const text = (max) => z.string().trim().max(max);

// Everything that reaches the server from a browser goes through this schema.
export const ProfileSchema = z.object({
  name: text(80).min(1),
  headline: text(140).default(''),
  industries: z.array(z.enum(INDUSTRIES)).min(1).max(3),
  jobs: z.array(z.object({ title: text(100), company: text(100) })).max(8).default([]),
  schools: z.array(z.object({ name: text(120).min(1), field: text(100).default('') })).max(5).default([]),
  skills: z.array(text(40).min(1)).max(20).default([]),
  // Revealed only after both people choose to connect.
  contact: text(200).default(''),
});

// What the other person sees during a call. Contact details are deliberately absent.
export function publicCard(profile) {
  const { name, headline, industries, jobs, schools, skills } = profile;
  return { name: name.split(/\s+/)[0], headline, industries, jobs: jobs.slice(0, 3), schools, skills: skills.slice(0, 8) };
}

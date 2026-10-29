import { migrate } from '../db/migrate';
export default async function setup() { await migrate(); }

/**
 * Catalog barrel: the 20 stakeholder journeys in execution order.
 */
import type { Journey } from "../framework";
import { j01, j02, j03, j04, j05, j06 } from "./provider";
import { j07, j08, j09, j10, j11 } from "./fsm-cases";
import { j12, j13, j14, j15 } from "./cross";
import { j16, j17 } from "./patient";
import { j18, j19, j20 } from "./admin";

export const ALL_JOURNEYS: Journey[] = [
  j01, j02, j03, j04, j05, j06, j07, j08, j09, j10,
  j11, j12, j13, j14, j15, j16, j17, j18, j19, j20,
];

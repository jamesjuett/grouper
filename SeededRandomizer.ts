import randseed from 'random-seed';
const { create } = randseed;
import type { RandomSeed } from 'random-seed';
import { shuffle } from 'shuffle-seed';
import { assert } from './util';

export class SeededRandomizer {

  private rng: RandomSeed;

  public constructor(seed: string) {
    this.rng = create(seed);
  }

  /**
   * @returns A random floating point number between 0 (inclusive) and 1 (exclusive).
   */
  public float() {
    return this.rng.random();
  }

  /**
   * @returns A random integer between 0 (inclusive) and n (exclusive).
   */
  public range(n: number) {
    return this.rng.range(n);
  };

  /**
   * @requires `choices` is non-empty.
   * @returns One of the elements of `choices`, selected randomly.
   */
  public chooseOne<T>(choices: readonly T[]) {
    assert(choices.length > 0, "No choices available.");

    // Implemented in terms of chooseN to ensure randomization is
    // deterministic regardless of whether you use chooseOne(choices)
    // or chooseN(choices, 1)
    return this.chooseN(choices, 1)[0];
  };

  /**
   * Randomly selects `n` elements from `choices` (repetition is not allowed).
   * @requires `choices` is non-empty and `n` is less than or equal to the length of `choices`.
   * @returns An array of `n` elements from `choices`, selected randomly.
   */
  public chooseN<T>(choices: readonly T[], n: number) {
    assert(choices.length >= n, "Number to randomly choose is larger than number of choices.");

    // Prefer not to consume any randomness when it's not necessary.
    // That way, the use of a superfulous randomization like chooseN([x], 1)
    // will be deterministically equivalent to not using that randomization.
    if (choices.length === 1) {
      return choices;
    }
    
    return choices
      .slice()
      .map(c => ({ i: this.rng.random(), c: c }))
      .sort((a, b) => a.i - b.i)
      .map(x => x.c)
      .slice(0, n);
  }

  public shuffle<T>(original: readonly T[]) {
    return shuffle(original, ""+this.float());
  }

}
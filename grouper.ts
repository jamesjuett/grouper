
import 'array-flat-polyfill';
import "colors";
import csv from 'csv-parser';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { SeededRandomizer } from './SeededRandomizer';
import { asMutable, assertFalse, assertNever } from './util';
import Papa from 'papaparse';

function assert(condition: any, message: string = "") : asserts condition {
  if (!condition) {
      throw Error("Assert failed: " + message);
  }
};

type InfoKind = {
  kind: "id" | "section" | "number" | "string" | "boolean" | "bool" | readonly (number | string)[],
  transform?: (val: string) => string,
  allow_missing?: boolean,
};

type InfoValue<T extends InfoKind> = 
  T["kind"] extends "id" ? string :
  T["kind"] extends "section" ? string :
  T["kind"] extends "number" ? number :
  T["kind"] extends "string" ? string :
  T["kind"] extends "boolean" ? boolean :
  T["kind"] extends "bool" ? boolean :
  T["kind"] extends readonly (infer E)[] ? E : never;

type InfoSpec = Record<string, InfoKind>;

type Info<Spec extends InfoSpec> = {
  [K in keyof Spec]: InfoValue<Spec[K]>;
};

export type Student<Specs extends Record<string, InfoSpec>, Confirmed extends keyof Specs = never> =
  & {
    id: string;
    section: string | undefined;
  }
  & {
    [K in Extract<keyof Specs, Confirmed>]: Info<Specs[K]>;
  }
  & Partial<{
    [K in keyof Specs]: Info<Specs[K]>;
  }>;


export type Group<Specs extends Record<string, InfoSpec>, Confirmed extends keyof Specs = never> = {
  students: readonly Student<Specs, Confirmed>[];
}

export function hasInfo<Specs extends Record<string, InfoSpec>, Source extends keyof Specs>(student: Student<Specs>, source: Source): student is Student<Specs, Source> {
  return <any>student[source] !== undefined;
}

export function allHaveInfo<Specs extends Record<string, InfoSpec>, Source extends keyof Specs>(group: Group<Specs>, source: Source): group is Group<Specs, Source> {
  return group.students.every(s => hasInfo(s, source));
}

export function someHaveInfo<Specs extends Record<string, InfoSpec>, Source extends keyof Specs>(group: Group<Specs>, source: Source): boolean {
  return group.students.some(s => hasInfo(s, source));
}

export function withInfo<Specs extends Record<string, InfoSpec>, Source extends keyof Specs>(students: readonly Student<Specs>[], source: Source): Student<Specs, Source>[] {
  return <Student<Specs, Source>[]>students.filter(s => hasInfo(s, source));
}

export function withoutInfo<Specs extends Record<string, InfoSpec>, PrevSources extends keyof Specs>(students: readonly Student<Specs, PrevSources>[], source: keyof Specs): Student<Specs, PrevSources>[] {
  return students.filter(s => !hasInfo(s, source));
}


function parseValue(source: string, property: string, kind: InfoKind, raw: string | undefined) {
  if (kind.allow_missing && raw === undefined) {
    return undefined;
  }
  else {
    assert(raw !== undefined, `Missing value for ${source}.${property}`);
  }
  const val = kind.transform ? kind.transform(raw) : raw;

  if (kind.kind === "id") {
    return val;
  }
  else if (kind.kind === "section") {
    return val;
  }
  else if (kind.kind === "number") {
    return parseFloat(val);
  } else if (kind.kind === "string") {
    return val;
  } else if (kind.kind === "boolean" || kind.kind === "bool") {
    const adjusted = val.toLowerCase();
    assert(adjusted === "true" || adjusted === "false", `Invalid boolean value for ${source}.${property}: ${val}`)
    return adjusted === "true";
  } else if (kind.kind instanceof Array) {
    const match = kind.kind.find(v =>
      typeof v === "string" ? v === val :
      typeof v === "number" ? v === parseFloat(val) :
      false
    );
    return match ?? assertFalse(`Invalid value for ${source}.${property}: ${val}`);
  }
  else {
    assertNever(kind.kind);
  }
}

type AlgorithmConfig = {
  n_opt_1: number,
  n_opt_2: number,
  n_restarts: number,
  group_size: number,
};

type GrouperOptions<Specs extends Record<string, InfoSpec>> = {
  specs: Specs,
  data: { [k in keyof Specs]: string }
  objective: (g: Group<Specs>) => number,
  describe_student?: (s: Student<Specs>) => string,
  describe_group?: (g: Group<Specs>) => string,
  seed?: string;
  algorithm?: Partial<AlgorithmConfig>
};

const DEFAULT_ALGORITHM = {
  n_opt_1: 100, // set to 10000 for full run
  n_opt_2: 10, // set to 1000 for full run
  n_restarts: 100,
  group_size : 4,
};

export class Grouper<Specs extends Record<string, InfoSpec>> {

  private static DEFAULT_DESCRIBE_STUDENT<Specs extends Record<string, InfoSpec>>(s: Student<Specs>) {
    let desc = s.id + ":";
    for (let source in s) {
      if (source !== "id" && source !== "section") {
        for(let k in (<any>s)[source]) {
          desc += ` ${k}=${(<any>s)[source]![k]}`;
        }
      }
    }
    return desc;
  }
  
  private static DEFAULT_DESCRIBE_GROUP<Specs extends Record<string, InfoSpec>>(this: Grouper<Specs>, g: Group<Specs>) {
    return g.students.map(s => this.describe_student(s)).join("\n");
  }

  public readonly specs: Specs;
  public readonly data: { [k in keyof Specs]: string };
  public readonly objective: (g: Group<Specs>) => number;
  public readonly algorithm: AlgorithmConfig;
  private readonly describe_student: (s: Student<Specs>) => string;
  private readonly describe_group: (s: Group<Specs>) => string;

  public readonly students: readonly Student<Specs>[] = [];
  public readonly students_map: {[index:string]: Student<Specs> | undefined} = {};
  private readonly section_names: readonly string[] = [];
  public readonly sections: readonly (readonly Group<Specs>[])[] = [];

  private readonly rng: SeededRandomizer;

  public constructor(options: GrouperOptions<Specs>) {
    this.specs = options.specs;
    this.data = options.data;
    Object.entries(this.specs).forEach(([source, props]) => assert(Object.values(props).filter(kind => kind.kind === "id").length === 1, `Must be exactly one id property in ${source}`));
    Object.entries(this.specs).forEach(([source, props]) => assert(Object.values(props).filter(kind => kind.kind === "section").length <= 1, `Must be at most one section property in ${source}`));
    this.objective = options.objective;
    this.algorithm = { ...DEFAULT_ALGORITHM, ...options.algorithm };
    this.describe_student = options.describe_student ?? Grouper.DEFAULT_DESCRIBE_STUDENT;
    this.describe_group = options.describe_group ?? Grouper.DEFAULT_DESCRIBE_GROUP;
    this.rng = new SeededRandomizer(options.seed ?? ""+Date.now());
  }
  
  private createRandomGroups(students_orig: readonly Student<Specs>[]) {
  
    let students = this.rng.shuffle(students_orig.slice()); // clones and shuffles array
    
    // Let's say I have N students in a lab and I want to form groups of size X.
    // But let's say there are 33 students and X = 4. Then I would want these groups:
    // [4, 4, 4, 4, 4, 4, 3, 3, 3]
    // How do I figure out how many groups of X-1 I should have in the general case?
    // last group size = N % X ..... we want to get this to N - 1
    // so we need to steal 1 student from (X - 1) - (N % X) other groups
    // Then we will have (X - 1) - (N % X) + 1 = X - N % X groups of N-1
    // Extra % this.algorithm.group_size at the end handles case where there's 0
    let gNm1 = (this.algorithm.group_size - (students.length % this.algorithm.group_size)) % this.algorithm.group_size;
  
    if (gNm1 === 0) {
      // If there are e.g. no groups of N-1, allow a random chance that we
      // instead form this.algorithm.group_size of them. This helps allow different group
      // sizes on each random restart.
      if (this.rng.float() < 0.5) {
        gNm1 = this.algorithm.group_size;
      }
    }
  
    let groups: Group<Specs>[] = [];
    let i = 0; 
    while (i < students.length) {
      let group: Student<Specs>[] = [];
      let size = gNm1-- > 0 ? this.algorithm.group_size-1 : this.algorithm.group_size;
      for (let j = 0; j < size && i < students.length; ++j) {
        group.push(students[i++]);
      }
      groups.push({students: group});
    }
  
    return groups;
  }
  
  /**
   * 
   * @requires g1 and g2 are not aliases for the same group
   * @returns 
   */
  private swap_random_students(g1: Group<Specs>, g2: Group<Specs>): [Group<Specs>, Group<Specs>] {
  
    // copy student arrays
    let s1 = g1.students.slice();
    let s2 = g2.students.slice();
  
    // swap random students
    let i1 = this.rng.range(s1.length); // 0
    let i2 = this.rng.range(s2.length); // 3
    [s1[i1], s2[i2]] = [s2[i2], s1[i1]];
  
    // return new groups
    return [{ students: s1 }, { students: s2 }];
  }
  
  private optimize(groups: Group<Specs>[]) {
    for (let i = 0; i < this.algorithm.n_opt_1; ++i) {
  
      // pick two random groups
      let i1 = this.rng.range(groups.length);
      let i2 = this.rng.range(groups.length);
  
      if (i1 === i2) {
        // Don't allow a group to swap students with itself.
        // This means we don't have to worry about clobbering data.
        continue;
      }
  
      let g1 = groups[i1];
      let g2 = groups[i2];
  
      let h_before = this.objective(g1) + this.objective(g2);
  
      let g1_new: Group<Specs>;
      let g2_new: Group<Specs>;
  
      // swap one student between them
      [g1_new, g2_new] = this.swap_random_students(g1, g2);
  
      let h_after = this.objective(g1_new) + this.objective(g2_new);
  
      if (h_after <= h_before) {
        groups[i1] = g1_new;
        groups[i2] = g2_new;
      }
    }
  }
  
  private optimize2(groups: Group<Specs>[]) {
    
    // sort in descending order
    groups.sort((a, b) => this.objective(b) - this.objective(a));
  
    for (let i = 0; i < groups.length; ++i) {
  
      let g1 = groups[i];
  
      if (this.objective(g1) === 0) {
        continue;
      }
  
      for (let k = 0; k < groups.length; ++k) {
        if (k == i) { continue; }
  
        let g2 = groups[k];
    
        let h_before = this.objective(g1) + this.objective(g2);
    
        let g1_new: Group<Specs>;
        let g2_new: Group<Specs>;
    
        // swap one student between them
        [g1_new, g2_new] = this.swap_random_students(g1, g2);
    
        let h_after = this.objective(g1_new) + this.objective(g2_new);
    
        if (h_after <= h_before) {
          groups[i] = g1_new;
          groups[k] = g2_new;
          break;
        }
  
      }
  
    }
  }

  

  private createOptimalGroups(students: Student<Specs>[]) {
    let groups = this.createRandomGroups(students);
    this.optimize(groups);
    for (let i = 0; i < this.algorithm.n_opt_2; ++i) {
      this.optimize2(groups);
    }
    return groups;
  }

  public createGroups() {
    for (let source in this.specs) {
      let data = Papa.parse<Partial<Record<string,string>>>(readFileSync(this.data[source], "utf8"), {
        header: true,
        skipEmptyLines: true
      }).data;

      const id_key = Object.keys(this.specs[source]).find(k => this.specs[source][k].kind === "id")!;
      const section_key = Object.keys(this.specs[source]).find(k => this.specs[source][k].kind === "section");

      data.map(row => {

        const parsed_info = Object.fromEntries(Object.entries(this.specs[source]).map(([k, kind]) => {
          return [k, parseValue(source, k, kind, row[k])];
        }));

        const parsed_id = parsed_info[id_key] ?? assertFalse(`Missing id field '${id_key}' in ${source}.csv`);
        const parsed_section = section_key && (parsed_info[section_key] ?? assertFalse(`Missing section field '${section_key}' in ${source}.csv`));
        assert(typeof parsed_id === "string");
        assert(parsed_section === undefined || typeof parsed_section === "string");
        
        if (!this.students_map[parsed_id]) {
          // new entry
          this.students_map[parsed_id] = <Student<Specs>>{ id: parsed_id, section: parsed_section, [source]: parsed_info };
        }
        else {
          // existing entry
          const student = this.students_map[parsed_id]!;
          student.section ??= parsed_section;
          assert(!section_key || student.section === parsed_section, `Mismatched section for ${parsed_id}: ${student.section} vs ${parsed_section}`);
          assert(student[source] === undefined, `Duplicate data for ${parsed_id} in ${source}`);
          (<any>student)[source] = parsed_info;
        }
        const student = this.students_map[parsed_id] ?? (
          this.students_map[parsed_id] = <Student<Specs>>{ id: parsed_id, section: parsed_section}
        );

        if (student.section && this.section_names.indexOf(student.section) === -1) {
          asMutable(this.section_names).push(student.section);
        }

      });
    }

    asMutable(this).students = <Student<Specs>[]>Object.values(this.students_map);

    asMutable(this.section_names).sort((a,b) => a.localeCompare(b));
    asMutable(this).sections = [...this.section_names, undefined].map((sectionNum) => {
      console.log(`Forming groups for section ${sectionNum}...`)
      let students = this.students.filter(s => s.section === sectionNum);

      if (students.length === 0) {
        console.log(`No students in section ${sectionNum}`);
        return [];
      }

      let bestH = Infinity;
      let bestGroups: Group<Specs>[] = [];
      for(let i = 0; i < this.algorithm.n_restarts; ++i) {
        let groups = this.createOptimalGroups(students);
        let h = groups.reduce((prev, g) => prev + this.objective(g), 0);
        if (h < bestH) {
          bestH = h;
          bestGroups = groups;
        }
      }
      return bestGroups.sort((a, b) => this.objective(b) - this.objective(a));
    });
  }
};





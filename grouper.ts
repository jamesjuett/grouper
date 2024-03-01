
import 'array-flat-polyfill';
import "colors";
import csv from 'csv-parser';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { SeededRandomizer } from './SeededRandomizer';
import { asMutable, assertFalse, assertNever } from './util';
import { parse } from 'papaparse';

function assert(condition: any, message: string = "") : asserts condition {
  if (!condition) {
      throw Error("Assert failed: " + message);
  }
};


const N_OPT_1 = 100; // Set to 10000 for a full run
const N_OPT_2 = 10; // Set to 1000 for a full run
const N_RESTARTS = 100;

// survey qualities
enum Qualities {
  pref_less_comfortable = "pref_less_comfortable",
  pref_fast_pace = "pref_fast_pace",
  pref_retake = "pref_retake",
  pref_plus_12 = "pref_plus_12",
}

type SurveyRowData = {
  readonly email: string;
  readonly preferred_name: string;
  readonly previous_experience: string;
  readonly confidence: string;
} & {
  [k in Qualities]: string
};

const GROUP_SIZE = 4;

// interface StudentBase {
//   readonly uniqname: string;
//   readonly email: string;
//   readonly section: number;
//   readonly fullName: string;
//   readonly didSurvey: boolean;
// }

// interface NonSurveyStudent extends StudentBase {
//   readonly didSurvey: false;
//   readonly preferredName?: undefined;
//   readonly background?: undefined;
//   readonly confidence?: undefined;
//   readonly qualities?: undefined;
// }

// interface SurveyStudent extends StudentBase {
//   readonly didSurvey: true;
//   readonly preferredName: string;
//   readonly background: 1 | 2 | 3 | 4 | 5;
//   readonly confidence: 1 | 2 | 3 | 4 | 5;
//   readonly qualities: {
//     [k in Qualities]: boolean;
//   };
// }

// export type Student = NonSurveyStudent | SurveyStudent;


// export function allDidSurvey<Specs extends Record<string, InfoSpec>, Source extends string>(students: readonly Student<Specs>[], source: Source): students is readonly ({Source: Info<Specs[Source]>})[] {
//   return students.every(s => s.didSurvey);
// }

// export function noneDidSurvey(students: readonly Student[]): students is readonly SurveyStudent[] {
//   return students.every(s => !s.didSurvey);
// }

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


type InfoKind = {
  kind: "id" | "section" | "number" | "string" | "boolean" | "bool" | readonly (number | string)[],
  transform?: (val: string) => string
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


export class Test<Specs extends Record<string, InfoSpec>> {


  public readonly data!: {
    [K in keyof Specs]: Info<Specs[K]>;
  };

  public constructor(specs: Specs) {
    
  }

};

const SPECS = {
  survey: {
    confidence: [1,2,3,4,5],
    "long name": "string",
  },
  roster: {
    bleh: "number"
  }
} as const;

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

type GrouperOptions<Specs extends Record<string, InfoSpec>> = {
  specs: Specs,
  objective: (g: Group<Specs>) => number,
  describe_student?: (s: Student<Specs>) => string,
  describe_group?: (g: Group<Specs>) => string,
  seed?: string;
};

function parseValue(source: string, property: string, kind: InfoKind, raw: string | undefined) {
  assert(raw !== undefined, `Missing value for ${source}.${property}`);
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
  public readonly objective: (g: Group<Specs>) => number;
  private readonly describe_student: (s: Student<Specs>) => string;
  private readonly describe_group: (s: Group<Specs>) => string;

  public students: Student<Specs>[] = [];
  public readonly students_map: {[index:string]: Student<Specs> | undefined} = {};
  private readonly section_names: string[] = [];
  private readonly _sections: Group<Specs>[][] = [];
  public readonly sections: readonly (readonly Group<Specs>[])[] = this._sections;

  private readonly rng: SeededRandomizer;

  public constructor(options: GrouperOptions<Specs>) {
    this.specs = options.specs;
    Object.entries(this.specs).forEach(([source, props]) => assert(Object.values(props).some(kind => kind.kind === "id"), `Missing id in ${source}`));
    this.objective = options.objective;
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
    // Extra % GROUP_SIZE at the end handles case where there's 0
    let gNm1 = (GROUP_SIZE - (students.length % GROUP_SIZE)) % GROUP_SIZE;
  
    if (gNm1 === 0) {
      // If there are e.g. no groups of N-1, allow a random chance that we
      // instead form GROUP_SIZE of them. This helps allow different group
      // sizes on each random restart.
      if (this.rng.float() < 0.5) {
        gNm1 = GROUP_SIZE;
      }
    }
  
    let groups: Group<Specs>[] = [];
    let i = 0; 
    while (i < students.length) {
      let group: Student<Specs>[] = [];
      let size = gNm1-- > 0 ? GROUP_SIZE-1 : GROUP_SIZE;
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
    for (let i = 0; i < N_OPT_1; ++i) {
  
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
    for (let i = 0; i < N_OPT_2; ++i) {
      this.optimize2(groups);
    }
    return groups;
  }

  public createGroups() {
    for (let source in this.specs) {
      let data = parse<Partial<Record<string,string>>>(readFileSync(`data/${source}.csv`, "utf8"), {
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
          assert(student.section === parsed_section, `Mismatched section for ${parsed_id}: ${student.section} vs ${parsed_section}`);
          assert(student[source] === undefined, `Duplicate data for ${parsed_id} in ${source}`);
          (<any>student)[source] = parsed_info;
        }
        const student = this.students_map[parsed_id] ?? (
          this.students_map[parsed_id] = <Student<Specs>>{ id: parsed_id, section: parsed_section}
        );

        if (student.section && this.section_names.indexOf(student.section) === -1) {
          this.section_names.push(student.section);
        }

      });
    }

    this.students = <Student<Specs>[]>Object.values(this.students_map);

    this.section_names.sort((a,b) => a.localeCompare(b));
    let sections = [...this.section_names, undefined].map((sectionNum) => {
      console.log(`Forming groups for section ${sectionNum}...`)
      let students = this.students.filter(s => s.section === sectionNum);

      if (students.length === 0) {
        console.log(`No students in section ${sectionNum}`);
        return [];
      }

      let bestH = 10000000000;
      let bestGroups: Group<Specs>[] = [];
      for(let i = 0; i < N_RESTARTS; ++i) { // 100 random restarts
        let groups = this.createOptimalGroups(students);
        let h = groups.reduce((prev, g) => prev + this.objective(g), 0);
        if (h < bestH) {
          bestH = h;
          bestGroups = groups;
        }
      }
      return bestGroups;
    });

    let groups = sections.flat();
    
    // sort in ascending order (remember lower objective is better)
    // groups.sort((a, b) => this.objective(a) - this.objective(b));

    let output = "";
    groups.forEach((g: Group<Specs>, i: number) => {
      output += `Group ${i}: s=${g.students[0].section} h=${this.objective(g)}\n`;
      output += this.describe_group(g) + "\n";
      output += "\n";
    });

    writeFileSync("out/group_info.txt", output);

    output = "";
    output += "group,section,score,emails,name1,name2,name3,name4,timeslot\n"
    groups.forEach((g: Group<Specs>, i: number) => {
      output += "Group" + i + "," + g.students[0].section + "," + this.objective(g) + ",";
      output += '"' + g.students.map(s => s.email).join(",") + '",';
      output += (g.students[0]?.preferredName ?? "") + ","
      output += (g.students[1]?.preferredName ?? "") + ","
      output += (g.students[2]?.preferredName ?? "") + ","
      output += (g.students[3]?.preferredName ?? "") + ","
      output += g.students[0].section;
      output += "\n";
    });

    writeFileSync("out/groups.txt", output);

    output = "";
    output += "section,group,uniqname,name\n"
    sections.forEach(groups => {
      groups.forEach((g: Group<Specs>, i: number) => {
        g.students.forEach(s => {
          output += `${s.section},${i+1},${s.uniqname},${s.preferredName || s.fullName || s.uniqname}\n`; 
        });
        for(let j = 0; j < GROUP_SIZE - g.students.length; ++j) {
          output += "\n";
        }
      });
    });

    writeFileSync("out/sections.csv", output);
    writeFileSync("out/assignments.json", JSON.stringify(sections, null, 2));

  }
};






import csv from 'csv-parser';
import { createReadStream, fstat, mkdirSync, writeFile, writeFileSync } from 'fs';
import 'array-flat-polyfill';
import { shuffle, groupBy, random } from 'underscore';
import "colors";

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

interface StudentBase {
  readonly uniqname: string;
  readonly email: string;
  readonly section: number;
  readonly fullName: string;
  readonly didSurvey: boolean;
}

interface NonSurveyStudent extends StudentBase {
  readonly didSurvey: false;
  readonly preferredName?: undefined;
  readonly background?: undefined;
  readonly confidence?: undefined;
  readonly qualities?: undefined;
}

interface SurveyStudent extends StudentBase {
  readonly didSurvey: true;
  readonly preferredName: string;
  readonly background: 1 | 2 | 3 | 4 | 5;
  readonly confidence: 1 | 2 | 3 | 4 | 5;
  readonly qualities: {
    [k in Qualities]: boolean;
  };
}

type Student = NonSurveyStudent | SurveyStudent;

interface Group {
  students: readonly Student[];
}

function describeStudent(s: Student) {
  if (!s.didSurvey) {
    return s.email;
  }
  else {
    return `${s.email} ${s.preferredName}: bg(${s.background}) conf(${s.confidence})${s.qualities.pref_retake ? "(retake)" : ""}${s.qualities.pref_plus_12 ? "(+12)" : ""}${s.qualities.pref_fast_pace ? "(fast pace)" : ""}${s.qualities.pref_less_comfortable ? "(less comfortable)" : ""}`
  }
  
}

function allDidSurvey(students: readonly Student[]): students is readonly SurveyStudent[] {
  return students.every(s => s.didSurvey);
}

function noneDidSurvey(students: readonly Student[]): students is readonly SurveyStudent[] {
  return students.every(s => !s.didSurvey);
}

function createRandomGroups(students_orig: readonly Student[]) {

  let students = shuffle(students_orig.slice()); // clones and shuffles array
  
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
    if (Math.random() < 0.5) {
      gNm1 = GROUP_SIZE;
    }
  }

  let groups: Group[] = [];
  let i = 0; 
  while (i < students.length) {
    let group: Student[] = [];
    let size = gNm1-- > 0 ? GROUP_SIZE-1 : GROUP_SIZE;
    for (let j = 0; j < size && i < students.length; ++j) {
      group.push(students[i++]);
    }
    groups.push({students: group});
  }

  return groups;
}

function heuristic(g: Group) {
  let groupStudents = g.students;

  let score = 0;
  let g_size = groupStudents.length;

  if (noneDidSurvey(groupStudents)) {
    return 0; // Nobody did survey - keep them all together in a "random" group
  }

  if (!allDidSurvey(groupStudents)) {
    score += 100000; // Mix of survey and non-survey, want to avoid

    // For the rest, just consider students who did the survey
    groupStudents = groupStudents.filter(g => g.didSurvey);
  }
  
  assert(allDidSurvey(groupStudents));
  let surveyStudents = groupStudents;

  // Prefer groups of all retakers
  let numRetakers = surveyStudents.filter(s => s.qualities.pref_retake).length;
  if (numRetakers > 0 && numRetakers !== g_size) {
    // mixed retakers vs non retakers
    score += 1000000;
  }

  if (surveyStudents.some(s => s.background >= 4) &&
    surveyStudents.some(s => s.background === 1)) {
    // A 1 background paired with 4s and 5s (bad)
    score += 10000;
  }
  else if (surveyStudents.length >= 0 && surveyStudents.every(s => s.background <= 2)) {
    // Everyone 2 or less background (bad)
    score += 10000;
  }
  else if (surveyStudents.some(
    s => surveyStudents.filter(other => other !== s).every(other => other.background > s.background + 1)
  )) {
    // Any student for whom all the others are more than 1 greater in backgournd experience
    score += 10000;
  }

  if (surveyStudents.filter(s => s.confidence === 1 || s.confidence === 2).length === 1) {
    // only 1 student with 1 or 2 confidence by themselves
    score += 10000;
  }

  if (surveyStudents.some(s => s.confidence === 1 || s.confidence === 2)) {
    // something
    if (!surveyStudents.some(s => s.confidence === 3)) {
      score += 10000;
    }
    if (surveyStudents.filter(s => s.confidence === 5).length >= 2) {
      score += 10000;
    }
    if (surveyStudents.some(s => s.qualities.pref_fast_pace && s.confidence > 3)) {
      score += 10000;
    }
  }
  
  // Penalize for groups of 3. This is a smaller penalty than e.g. retakers paired
  // with non-retakers, which means we'll try to form groups of 4 if we can but also
  // allow groups of 3 if it helps us resolve bigger issues.
  if (g_size < GROUP_SIZE) {
    score += 10000;
  }

  // Any student who prefers less comfortable (but not a fast pace) and is paired with
  // 2 or more others who prefer a fast pace
  if (surveyStudents.some(s => s.qualities.pref_less_comfortable && !s.qualities.pref_fast_pace) &&
      surveyStudents.filter(s => s.qualities.pref_fast_pace).length > 2) {
    score += 1000;
  }
  
  // Exactly one student who prefers a fast pace
  if (surveyStudents.filter(s => s.qualities.pref_fast_pace).length === 1 ) {
    score += 1000;
  }

  // A group with only one "less comfortable" student is bad
  if (surveyStudents.filter(s => s.qualities.pref_less_comfortable).length === 1) {
    score += 1000;
  }

  // A "confident" student paired with students who prefer less comfortable (unless it's themselves)
  if (surveyStudents.some(
    s => (s.confidence === 5) && surveyStudents.filter(other => other !== s).some(other => other.qualities.pref_less_comfortable)
  )) {
    score += 1000;
  }

  return score;
}

function swap_random_students(g1: Group, g2: Group): [Group, Group] {

  // copy student arrays
  let s1 = g1.students.slice();
  let s2 = g2.students.slice();

  // swap random students
  let i1 = random(0, s1.length - 1);
  let i2 = random(0, s2.length - 1);
  [s1[i1], s2[i2]] = [s2[i2], s1[i1]];

  // return new groups
  return [{ students: s1 }, { students: s2 }];
}

function optimize(groups: Group[]) {
  for (let i = 0; i < N_OPT_1; ++i) {

    // pick two random groups
    let i1 = random(0, groups.length - 1);
    let i2 = random(0, groups.length - 1);

    if (i1 === i2) {
      // cannot allow a group to swap students with itself
      // for example:
      //   [x, y, z] swaps index 0 with [x, y, z] index 3
      //   then you get
      //   [z, y, z]  and [x, y, x] which is very bad
      continue;
    }

    let g1 = groups[i1];
    let g2 = groups[i2];

    let h_before = heuristic(g1) + heuristic(g2);

    let g1_new: Group;
    let g2_new: Group;

    // swap one student between them
    [g1_new, g2_new] = swap_random_students(g1, g2);

    let h_after = heuristic(g1_new) + heuristic(g2_new);

    if (h_after <= h_before) {
      groups[i1] = g1_new;
      groups[i2] = g2_new;
    }
  }
}

function optimize2(groups: Group[]) {
  
  // sort in descending order
  groups.sort((a, b) => heuristic(b) - heuristic(a));

  for (let i = 0; i < groups.length; ++i) {

    let g1 = groups[i];

    if (heuristic(g1) === 0) {
      continue;
    }

    for (let k = 0; k < groups.length; ++k) {
      if (k == i) { continue; }

      let g2 = groups[k];
  
      let h_before = heuristic(g1) + heuristic(g2);
  
      let g1_new: Group;
      let g2_new: Group;
  
      // swap one student between them
      [g1_new, g2_new] = swap_random_students(g1, g2);
  
      let h_after = heuristic(g1_new) + heuristic(g2_new);
  
      if (h_after <= h_before) {
        groups[i] = g1_new;
        groups[k] = g2_new;
        break;
      }

    }

  }
}


const STUDENTS: Student[] = [];
const STUDENTS_MAP: {[index:string]: Student | undefined} = {};

const SECTIONS: number[] = []; 

createReadStream('data/roster.csv')
  .pipe(csv())
  .on('data', (row: {[index: string]: any}) => {

    let uniqname: string = row["uniqname"].toLowerCase();
    let fullName: string = row["Name"];
    let section: number = parseInt(row["section"]);

    // track all sections that we see
    if (SECTIONS.indexOf(section) === -1) {
      SECTIONS.push(section);
    }

    // Skip duplicates
    if (STUDENTS_MAP[uniqname + "@umich.edu"]) {
      return;
    }

    let student: Student = {
      uniqname: uniqname,
      email: uniqname + "@umich.edu",
      fullName: fullName,
      section: section,
      didSurvey: false
    };
    STUDENTS.push(student);
    STUDENTS_MAP[student.email!] = student;

  }).on('end', () => {
    createReadStream('data/survey.csv')
      .pipe(csv())
      .on('data', (row: SurveyRowData) => {
        // Called for each row in data with a map of column headings to data for that row

        // match by email against survey results
        let student = STUDENTS_MAP[row.email];

        if (!student) {
          console.log(`Student not in roster: ${row.email}`.bgRed);
          return;
        }

        let qualities: { [k in Qualities]?: boolean; } = {};
        Object.values(Qualities).forEach(q => qualities[q] = row[q] === "TRUE");

        Object.assign(student, <Partial<SurveyStudent>>{
          email: row.email.trim(),
          preferredName: row.preferred_name,
          background: <1 | 2 | 3 | 4 | 5>parseInt(row.previous_experience),
          confidence: <1 | 2 | 3 | 4 | 5>parseInt(row.confidence),
          qualities: qualities,
          didSurvey: true
        });
      })
      .on('end', () => {
        
        mkdirSync("out", { recursive: true });

        SECTIONS.sort((a,b) => a - b);
        let sections = SECTIONS.map((sectionNum) => {
          console.log(`Forming groups for section ${sectionNum}...`)
          let students = STUDENTS.filter(s => s.section === sectionNum);

          let bestH = 10000000000;
          let bestGroups: Group[] = [];
          for(let i = 0; i < N_RESTARTS; ++i) { // 100 random restarts
            let groups = createOptimalGroups(students);
            let h = groups.reduce((prev, g) => prev + heuristic(g), 0);
            if (h < bestH) {
              bestH = h;
              bestGroups = groups;
            }
          }
          return bestGroups
        });

        let groups = sections.flat();
        
        // sort in ascending order (remember lower heuristic is better)
        // groups.sort((a, b) => heuristic(a) - heuristic(b));

        let output = "";
        groups.forEach((g: Group, i: number) => {
          output += `Group ${i}: s=${g.students[0].section} h=${heuristic(g)}\n`;
          output += g.students.map(s => describeStudent(s)).join("\n") + "\n";
          output += "\n";
        });

        writeFileSync("out/group_info.txt", output);

        output = "";
        output += "group,section,score,emails,name1,name2,name3,name4,timeslot\n"
        groups.forEach((g: Group, i: number) => {
          output += "Group" + i + "," + g.students[0].section + "," + heuristic(g) + ",";
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
          groups.forEach((g: Group, i: number) => {
            g.students.forEach(s => {
              output += `${s.section},${i+1},${s.uniqname},${s.preferredName || s.fullName || s.uniqname}\n`; 
            });
            for(let j = 0; j < GROUP_SIZE - g.students.length; ++j) {
              output += "\n";
            }
          });
        });

        writeFileSync("out/sections.csv", output);
        writeFileSync("out/assignments.json", JSON.stringify(sections));
      });
  });




function createOptimalGroups(students: Student[]) {
  let groups = createRandomGroups(students);
  optimize(groups);
  for (let i = 0; i < N_OPT_2; ++i) {
    optimize2(groups);
  }
  return groups;
}


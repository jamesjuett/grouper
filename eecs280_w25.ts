import { writeFileSync } from "fs";
import { Group, Grouper, Student, allHaveInfo, hasInfo, someHaveInfo, withInfo } from "./grouper";

const SPECS = {
  survey: {
    email: { kind: "id" },
    preferred_name: { kind: "string" },
    previous_experience: { kind: [1,2,3,4,5] },
    confidence: { kind: [1,2,3,4,5] },
    pref_less_comfortable: { kind: "boolean" },
    pref_fast_pace: { kind: "boolean" },
    pref_plus_12: { kind: "boolean" },
  },
  roster: {
    uniqname: { kind: "id", transform: (s: string) => s + "@umich.edu" },
    section: { kind: "section" },
  },
} as const;

function sample_objective(g: Group<typeof SPECS>) {
  let groupStudents = g.students;

  let score = 0;
  let g_size = groupStudents.length;

  if (!someHaveInfo(g, "survey")) {
    return 0; // Nobody did survey - keep them all together in a "random" group
  }

  if (!allHaveInfo(g, "survey")) {
    score += 10; // Mix of survey and non-survey, want to avoid
  }
  
  // For the rest, only consider students who did the survey
  let surveyStudents : Student<typeof SPECS, "survey">[] = withInfo(g.students, "survey");

  if (surveyStudents.some(s => s.survey.previous_experience >= 4) &&
    surveyStudents.some(s => s.survey.previous_experience === 1 && s.survey.confidence === 1)) {
    // A 1 previous_experience/confidence paired with 4s and 5s (bad)
    score += 10000;
  }
  else if (surveyStudents.length >= 0 && surveyStudents.every(s => s.survey.previous_experience <= 2)) {
    // Everyone 2 or less previous_experience (bad)
    score += 10000;
  }
  else if (surveyStudents.length >= 0 && surveyStudents.every(s => s.survey.confidence <= 3)) {
    // Everyone 3 or less confidence (bad)
    score += 10000;
  }
  else if (surveyStudents.some(
    s => surveyStudents.filter(other => other !== s).every(other => other.survey.previous_experience > s.survey.previous_experience + 1)
  )) {
    // Any student for whom all the others are more than 1 greater in backgournd experience
    score += 10000;
  }

  if (surveyStudents.filter(s => s.survey.confidence === 1 || s.survey.confidence === 2).length === 1) {
    // only 1 student with 1 or 2 confidence by themselves
    score += 10000;
  }

  if (surveyStudents.some(s => s.survey.confidence === 1 || s.survey.confidence === 2)) {
    // Avoid low confidence paired with two or more 5 confidence
    if (surveyStudents.filter(s => s.survey.confidence === 5).length >= 2) {
      score += 10000;
    }
    // Avoid low confidence paired with fast pace + high confidence
    if (surveyStudents.some(s => s.survey.pref_fast_pace && s.survey.confidence > 3)) {
      score += 10000;
    }
  }

  if (surveyStudents.length !== groupStudents.length) {
    // Repeat heuristic above, assuming sutdents who don't fill out the survey may be low confidence
    if (surveyStudents.filter(s => s.survey.confidence === 5).length >= 2) {
      score += 10000;
    }
    if (surveyStudents.some(s => s.survey.pref_fast_pace && s.survey.confidence > 3)) {
      score += 10000;
    }
  }

  // A group with less than half survey students (unless none of them are)
  if (surveyStudents.length < groupStudents.length / 2 && surveyStudents.length !== 0) {
    score += 100000;
  }
  
  // Penalize for groups of 3. This is a smaller penalty others,
  // which means we'll try to form groups of 4 if we can but also
  // allow groups of 3 if it helps us resolve bigger issues.
  if (g_size < 4) {
    score += 1000;
  }

  // Any student who prefers less comfortable (but not a fast pace) and is paired with
  // 2 or more others who prefer a fast pace
  if (surveyStudents.some(s => s.survey.pref_less_comfortable && !s.survey.pref_fast_pace) &&
      surveyStudents.filter(s => s.survey.pref_fast_pace).length > 2) {
    score += 1000;
  }
  
  // Exactly one student who prefers a fast pace
  if (surveyStudents.filter(s => s.survey.pref_fast_pace).length === 1 ) {
    score += 1000;
  }

  // A group with only one "less comfortable" student is bad
  if (surveyStudents.filter(s => s.survey.pref_less_comfortable).length === 1) {
    score += 1000;
  }

  // A "confident" student paired with students who prefer less comfortable (unless it's themselves)
  if (surveyStudents.some(
    s => (s.survey.confidence === 5) && surveyStudents.filter(other => other !== s).some(other => other.survey.pref_less_comfortable)
  )) {
    score += 1000;
  }

  return score;
}

const grouper_a = new Grouper({
  specs: SPECS,
  data: {
    survey: "data/survey.csv",
    roster: "data/roster.csv",
  },
  objective: sample_objective,
  algorithm: {
    n_opt_1: 1000,
    n_opt_2: 100,
    n_restarts: 100,
    group_size: 4,
  },
  seed: "seed",
});
grouper_a.createGroups();


function describe_student(s: Student<typeof SPECS>) {
  if (!hasInfo(s, "survey")) {
    return s.id;
  }
  else {
    return `${s.id} ${s.survey.preferred_name}: bg(${s.survey.previous_experience}) conf(${s.survey.confidence})${s.survey.pref_plus_12 ? "(+12)" : ""}${s.survey.pref_fast_pace ? "(fast pace)" : ""}${s.survey.pref_less_comfortable ? "(less comfortable)" : ""}`
  }
}


// let groups = grouper_a.sections.flat();
    
// // sort in ascending order (remember lower objective is better)
// // groups.sort((a, b) => this.objective(a) - this.objective(b));

// let output = "";
// groups.forEach((g, i) => {
//   g.students.forEach(s => {
//     output += `${s.id},${i+1}\n`;
//   });
// });

let output = "";
output += "id,group_a\n"
grouper_a.sections.forEach(groups => {
  groups.forEach((g, i) => {
    g.students.forEach(s => {
      output += `${s.id},${i+1}\n`;
    });
  });
});


writeFileSync("out/groups_a.csv", output);


const SPECS_B = {
  
  survey: {
    email: { kind: "id" },
    preferred_name: { kind: "string" },
    previous_experience: { kind: [1,2,3,4,5] },
    confidence: { kind: [1,2,3,4,5] },
    pref_less_comfortable: { kind: "boolean" },
    pref_fast_pace: { kind: "boolean" },
    pref_plus_12: { kind: "boolean" },
  },
  roster: {
    uniqname: { kind: "id", transform: (s: string) => s + "@umich.edu" },
    section: { kind: "section" },
  },
  group_a: {
    id: { kind: "id" },
    group_a: { kind: "number" },
  },
} as const;



function objective_b(g: Group<typeof SPECS_B>) {
  // if multiple students have the same group return 100000
  let score = sample_objective(g);
  if (g.students.length !== new Set(g.students.map(s => s.group_a?.group_a)).size) {
    return 10000000 + score;
  }
  else {
    return score;
  }
}

const grouper_b = new Grouper({
  specs: SPECS_B,
  data: {
    survey: "data/survey.csv",
    roster: "data/roster.csv",
    group_a: "out/groups_a.csv",
  },
  objective: objective_b,
  algorithm: {
    n_opt_1: 1000,
    n_opt_2: 100,
    n_restarts: 100,
    group_size: 4,
  },
  seed: "seed",
});
grouper_b.createGroups();


// output = "";
// output += "group,section,score,emails,name1,name2,name3,name4,timeslot\n"
// groups.forEach((g, i) => {
//   output += "Group" + i + "," + g.students[0].section + "," + grouper_a.objective(g) + ",";
//   output += '"' + g.students.map(s => s.id + "@umich.edu").join(",") + '",';
//   output += (g.students[0]?.survey?.preferred_name ?? g.students[0]?.id ?? "") + ","
//   output += (g.students[1]?.survey?.preferred_name ?? g.students[1]?.id ?? "") + ","
//   output += (g.students[2]?.survey?.preferred_name ?? g.students[2]?.id ?? "") + ","
//   output += (g.students[3]?.survey?.preferred_name ?? g.students[3]?.id ?? "") + ","
//   output += g.students[0].section;
//   output += "\n";
// });

// writeFileSync("out/groups.csv", output);





output = "";
output += "section,group_a,group_b,id,name\n"
grouper_b.sections.forEach(groups => {
  groups.forEach((g, i) => {
    g.students.forEach(s => {
      output += `${s.section},${s.group_a?.group_a},${i+1},${s.id},${s.survey?.preferred_name || s.id }\n`;
    });
    for(let j = 0; j < grouper_b.algorithm.group_size - g.students.length; ++j) {
      output += "\n";
    }
  });
});

writeFileSync("out/sections.csv", output);
writeFileSync("out/assignments_a.json", JSON.stringify(grouper_a.sections, null, 2));
writeFileSync("out/assignments_b.json", JSON.stringify(grouper_b.sections, null, 2));

output = "";
grouper_a.sections.flat().forEach((g, i) => {
  output += `Group ${i}: s=${g.students[0].section} h=${grouper_a.objective(g)}\n`;
  output += g.students.map(s => describe_student(s)).join("\n") + "\n";
  output += "\n";
});

writeFileSync("out/groups_a_info.txt", output);

output = "";
grouper_b.sections.flat().forEach((g, i) => {
  output += `Group ${i}: s=${g.students[0].section} h=${grouper_b.objective(g)}\n`;
  output += g.students.map(s => describe_student(s)).join("\n") + "\n";
  output += "\n";
});

writeFileSync("out/groups_b_info.txt", output);
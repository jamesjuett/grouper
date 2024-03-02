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
    pref_retake: { kind: "boolean" },
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
    score += 100000; // Mix of survey and non-survey, want to avoid
  }
  
  // For the rest, only consider students who did the survey
  let surveyStudents = withInfo(g.students, "survey");

  // Prefer groups of all retakers
  let numRetakers = surveyStudents.filter(s => s.survey.pref_retake).length;
  if (numRetakers > 0 && numRetakers !== g_size) {
    // mixed retakers vs non retakers
    score += 1000000;
  }

  if (surveyStudents.some(s => s.survey.previous_experience >= 4) &&
    surveyStudents.some(s => s.survey.previous_experience === 1)) {
    // A 1 previous_experience paired with 4s and 5s (bad)
    score += 10000;
  }
  else if (surveyStudents.length >= 0 && surveyStudents.every(s => s.survey.previous_experience <= 2)) {
    // Everyone 2 or less previous_experience (bad)
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
    // something
    if (!surveyStudents.some(s => s.survey.confidence === 3)) {
      score += 10000;
    }
    if (surveyStudents.filter(s => s.survey.confidence === 5).length >= 2) {
      score += 10000;
    }
    if (surveyStudents.some(s => s.survey.pref_fast_pace && s.survey.confidence > 3)) {
      score += 10000;
    }
  }
  
  // Penalize for groups of 3. This is a smaller penalty than e.g. retakers paired
  // with non-retakers, which means we'll try to form groups of 4 if we can but also
  // allow groups of 3 if it helps us resolve bigger issues.
  if (g_size < 4) {
    score += 10000;
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

const grouper = new Grouper({
  specs: SPECS,
  data: {
    survey: "test/in/survey.csv",
    roster: "test/in/roster.csv",
  },
  objective: sample_objective,
  algorithm: {
    n_opt_1: 100,
    n_opt_2: 10,
    n_restarts: 100,
    group_size: 4,
  },
  seed: "seed",
});
grouper.createGroups();


function describe_student(s: Student<typeof SPECS>) {
  if (!hasInfo(s, "survey")) {
    return s.id;
  }
  else {
    return `${s.id} ${s.survey.preferred_name}: bg(${s.survey.previous_experience}) conf(${s.survey.confidence})${s.survey.pref_retake ? "(retake)" : ""}${s.survey.pref_plus_12 ? "(+12)" : ""}${s.survey.pref_fast_pace ? "(fast pace)" : ""}${s.survey.pref_less_comfortable ? "(less comfortable)" : ""}`
  }
}


let groups = grouper.sections.flat();
    
// sort in ascending order (remember lower objective is better)
// groups.sort((a, b) => this.objective(a) - this.objective(b));

let output = "";
groups.forEach((g, i) => {
  output += `Group ${i}: s=${g.students[0].section} h=${grouper.objective(g)}\n`;
  output += g.students.map(s => describe_student(s)).join("\n") + "\n";
  output += "\n";
});

writeFileSync("out/group_info.txt", output);

output = "";
output += "group,section,score,emails,name1,name2,name3,name4,timeslot\n"
groups.forEach((g, i) => {
  output += "Group" + i + "," + g.students[0].section + "," + grouper.objective(g) + ",";
  output += '"' + g.students.map(s => s.id + "@umich.edu").join(",") + '",';
  output += (g.students[0]?.survey?.preferred_name ?? g.students[0]?.id ?? "") + ","
  output += (g.students[1]?.survey?.preferred_name ?? g.students[1]?.id ?? "") + ","
  output += (g.students[2]?.survey?.preferred_name ?? g.students[2]?.id ?? "") + ","
  output += (g.students[3]?.survey?.preferred_name ?? g.students[3]?.id ?? "") + ","
  output += g.students[0].section;
  output += "\n";
});

writeFileSync("out/groups.csv", output);

output = "";
output += "section,group,id,name\n"
grouper.sections.forEach(groups => {
  groups.forEach((g, i) => {
    g.students.forEach(s => {
      output += `${s.section},${i+1},${s.id},${s.survey?.preferred_name || s.id }\n`;
    });
    for(let j = 0; j < grouper.algorithm.group_size - g.students.length; ++j) {
      output += "\n";
    }
  });
});

writeFileSync("out/sections.csv", output);
writeFileSync("out/assignments.json", JSON.stringify(grouper.sections, null, 2));
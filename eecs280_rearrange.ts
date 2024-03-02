import { writeFileSync } from "fs";
import { Group, Grouper, Student, allHaveInfo, hasInfo, someHaveInfo, withInfo, withoutInfo } from "./grouper";

const SPECS = {
  survey: {
    email: { kind: "id", transform: (s: string) => s.replace("@umich.edu", "")},
    preferred_name: { kind: "string" },
    previous_experience: { kind: [1,2,3,4,5] },
    confidence: { kind: [1,2,3,4,5] },
    pref_less_comfortable: { kind: "boolean" },
    pref_fast_pace: { kind: "boolean" },
    pref_retake: { kind: "boolean" },
    pref_plus_12: { kind: "boolean" },
  },
  roster: {
    uniqname: { kind: "id" },
  },
  orig_assignments: {
    orig_section: { kind: "section" },
    orig_group: { kind: "number" },
    uniqname: { kind: "id" },
    preferred_name: { kind: "string" },
  }
} as const;

function sample_objective(g: Group<typeof SPECS>) {
  let groupStudents = g.students;

  let score = 0;
  let g_size = groupStudents.length;

  // add to score for studetns who have been in a group with each other before
  const orig = g.students.map(s => s.orig_assignments?.orig_section + "_" + s.orig_assignments?.orig_group);
  if (orig.length !== new Set(orig).size) {
    score += 100000;
  }
  return score;
}

const grouper = new Grouper({
  specs: SPECS,
  data: {
    roster: "data/280_mid_roster.csv",
    survey: "data/survey.csv",
    orig_assignments: "data/orig_assignments.csv",
  },
  objective: sample_objective,
  algorithm: {
    n_opt_1: 100,
    n_opt_2: 10,
    n_restarts: 100,
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
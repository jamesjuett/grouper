import { readFileSync } from "fs";
import { Grouper } from "../grouper";
import { expect } from "chai";


describe('Create Groups', function() {
  this.timeout(10000);

  it('Test Groups', async () => {
  
    const G = new Grouper({
      seed: "seed"
    });
    await G.createGroups();
    const expected = readFileSync("test/sample/assignments.json", "utf-8");
    const actual = JSON.stringify(G.sections, null, 2);
    const success = actual === expected;
    expect(success).to.be.true;
  });

});

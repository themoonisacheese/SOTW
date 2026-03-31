/**
 * Core logic for processing answers and generating template
 * Separated for testing - does not perform API calls or DOM manipulation
 * 
 * @param {Array} answers - Array of answer objects with score, body, owner, answer_id
 * @param {Object} post - Post object with question_id
 * @param {string} sotwNumber - SOTW number
 * @param {string} themeTitle - Theme title
 * @param {string} themeDescription - Theme description
 * @returns {Object} Result with template and metadata
 */
function processAnswersCore(answers, post, sotwNumber, themeTitle, themeDescription) {
    const tiedCount = answers.length;
    const upvoteCount = answers[0].score || 0;
    
    // Calculate display duration per winner (dividing 14 days equally)
    const durationPerWinnerDays = 14 / tiedCount;
    
    // Parse first answer for screenshot and tags (used as reference)
    // Handle both browser (DOMParser) and Node.js (mock) environments
    let screenshotUrl = "N/A";
    let tags = "";
    
    if (typeof DOMParser !== 'undefined') {
        // Browser environment
        const parser = new DOMParser();
        const doc = parser.parseFromString(answers[0].body, "text/html");
        const imgTag = doc.querySelector("img");
        screenshotUrl = imgTag ? imgTag.src : "N/A";

        const tagElements = doc.querySelectorAll("a.post-tag");
        tags = Array.from(tagElements).map(tag => tag.textContent).join(", ");
    } else {
        // Node.js environment - simple regex parsing
        const imgMatch = answers[0].body.match(/src="([^"]+)"/);
        screenshotUrl = imgMatch ? imgMatch[1] : "N/A";
        
        const tagMatches = answers[0].body.matchAll(/<a class="post-tag"[^>]*>([^<]+)<\/a>/g);
        const tagList = [];
        for (const match of tagMatches) {
            tagList.push(match[1]);
        }
        tags = tagList.join(", ");
    }

    const sotwNumberWithPostfix = (number) => {
        const suffixes = ["th", "st", "nd", "rd"];
        const value = number % 100;
        return number + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
    };

    const nextSotwNumber = parseInt(sotwNumber, 10) + 1;
    const nextSotwNumberWithPostfix = sotwNumberWithPostfix(nextSotwNumber);

    // Format tags for markdown output
    const tagMarkdown = tags.split(', ').map(tag => `[tag:${tag.trim()}]`).join(' ');

    // Calculate dates
    const closeDate = new Date();
    closeDate.setDate(closeDate.getDate() + 7);
    const finishDate = new Date(closeDate);
    finishDate.setDate(finishDate.getDate() + 7);

    const closeDateString = closeDate.toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' });
    const finishDateString = finishDate.toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' });

    // Build winners section based on tie status
    let winnersSection = '';
    let tieReferenceLinks = '';
    
    if (tiedCount === 1) {
        // Single winner
        winnersSection = `To start with, congratulations to the winner of the previous contest! [${answers[0].owner.display_name}][winning post]'s screenshot from ${tagMarkdown} won with ${upvoteCount} upvotes!

[![Last week's winning screenshot one][winning screenshot]][winning screenshot]`;
        tieReferenceLinks = `  [winning post]:       https://gaming.meta.stackexchange.com/a/${answers[0].answer_id}`;
    } else {
        // Multiple tied winners
        winnersSection = `To start with, congratulations to the winners of the previous contest! This contest resulted in a ${tiedCount}-way tie with the following entries:

`;
        
        answers.forEach((answer, index) => {
            const startDate = new Date(finishDate);
            startDate.setDate(startDate.getDate() + Math.floor(index * durationPerWinnerDays));
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + durationPerWinnerDays);
            
            const startDateString = startDate.toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' });
            const endDateString = endDate.toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' });
            
            winnersSection += `- [${answer.owner.display_name}][winner ${index + 1}]'s screenshot with ${upvoteCount} upvotes (featured ${startDateString}-${endDateString})\n`;
            tieReferenceLinks += `  [winner ${index + 1}]:       https://gaming.meta.stackexchange.com/a/${answer.answer_id}\n`;
        });
        
        winnersSection += `\n${tiedCount === 2 ? 'Both' : 'All ' + tiedCount} will be featured sequentially on the main site's photo widget.`;
    }

    const template = `<!-- # This contest is over.

*[previous contest][contest prev] | [next contest][contest next]* -->

Hello and welcome to the **${nextSotwNumberWithPostfix}** edition of the Screenshot of the Week!

${winnersSection}

---

To submit a screenshot, simply post it as an answer to this question, but please take note of the following:

- One screenshot per post, and one post per person, please!
- Limited picture modifications are allowed, such as cropping, simple filters, and blurring of identifying info such as names, but not adding other images or text.
- To ensure a fair playing field, please post screenshots you've taken yourself rather than ones you found online.
- Stack Exchange's [Code of Conduct][code of conduct] still applies - so if it would be unacceptable to post normally, it's unacceptable here.

Also, try to avoid pictures that include spoilers. We want everyone to be able to enjoy this contest, so the less spoilers the better.

### How long will the contest run?
We will accept submissions for a week, until ${closeDateString}, then have a second week-long period where only voting will be accepted. This is to give every submission, even those posted at the end of the first week, a chance to be voted on by everyone.

After the end of the second week, at ${finishDateString}, we will count upvotes only to determine the winning screenshot${tiedCount > 1 ? 's, which will be featured sequentially' : ', which will be featured'} on the main site's photo widget.

------------------------

# **This week's theme:** ${themeTitle}

${themeDescription}

As a reminder, we're always accepting suggestions for themed weeks, and have compiled that suggestion process into a [question of its own][themes collection]. Additionally, there is the [hall of fame][hall of fame] you can check out that contains all the previous contest winners.

  [contest prev]:       //meta.arqade.com/q/${post.question_id}
  [contest next]:       //meta.arqade.com/q/17226

  [winning post]:       https://gaming.meta.stackexchange.com/a/${answers[0].answer_id}
  [winning screenshot]: ${screenshotUrl}
${tieReferenceLinks}
  [code of conduct]:   //arqade.com/conduct
  [themes collection]: //meta.arqade.com/q/15029
  [hall of fame]:      //meta.arqade.com/q/14939`;

    return {
        template: template.trim(),
        metadata: {
            tiedCount,
            upvoteCount,
            winnersSection,
            closeDateString,
            finishDateString,
            screenshotUrl,
            tags
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { processAnswersCore };
}

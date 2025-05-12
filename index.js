document.getElementById('autofetch').addEventListener('click', async () => {
    try {
        const previousIdInput = document.getElementById('previous-id').value.trim();
        let lastPost;

        if (previousIdInput) {
            // Fetch specific post by ID
            const specificPostApiUrl = `https://api.stackexchange.com/2.3/questions/${previousIdInput}?site=gaming.meta.stackexchange.com`;
            const specificPostResponse = await fetch(specificPostApiUrl);
            const specificPostData = await specificPostResponse.json();

            if (specificPostData.items && specificPostData.items.length > 0) {
                lastPost = specificPostData.items[0];
            } else {
                alert("No post found with the specified Previous ID.");
                return;
            }
        } else {
            // Fetch the last post matching criteria
            const twoWeeksAgo = new Date();
            twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 15); // Last 2 weeks + 1 day
            const fromDate = Math.floor(twoWeeksAgo.getTime() / 1000); // Convert to Unix timestamp

            const apiUrl = `https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&tagged=screenshot-of-the-week;featured&site=gaming.meta.stackexchange.com&fromdate=${fromDate}`;
            const response = await fetch(apiUrl);
            const data = await response.json();

            if (data.items && data.items.length > 0) {
                lastPost = data.items[0];
            } else {
                alert("No posts found matching the criteria: posted in the last 2 weeks with the 'screenshot-of-the-week' and 'featured' tag.");
                return;
            }
        }

        const sotwNumberMatch = lastPost.title.match(/#(\d+)/); // Extract number after '#'
        const sotwNumber = sotwNumberMatch ? sotwNumberMatch[1] : "N/A";

        document.getElementById('sotw-number').value = sotwNumber;
        document.getElementById('previous-id').value = lastPost.question_id || "N/A";

        if (lastPost.accepted_answer_id) {
            const answerApiUrl = `https://api.stackexchange.com/2.3/answers/${lastPost.accepted_answer_id}?order=desc&sort=activity&site=gaming.meta.stackexchange.com&filter=withbody`;
            const answerResponse = await fetch(answerApiUrl);
            const answerData = await answerResponse.json();

            if (answerData.items && answerData.items.length > 0) {
                const acceptedAnswer = answerData.items[0];
                const parser = new DOMParser();
                const doc = parser.parseFromString(acceptedAnswer.body, "text/html");
                const imgTag = doc.querySelector("img");
                const screenshotUrl = imgTag ? imgTag.src : "N/A";

                const tagElements = doc.querySelectorAll("a.post-tag");
                const tags = Array.from(tagElements).map(tag => tag.textContent).join(", ");

                document.getElementById('winning-id').value = acceptedAnswer.answer_id || "N/A";
                document.getElementById('user').value = acceptedAnswer.owner.display_name || "N/A";
                document.getElementById('screenshot').value = screenshotUrl;
                document.getElementById('tag').value = tags || "N/A";
                document.getElementById('upvotes').value = acceptedAnswer.score || "N/A";

                const themeTitle = document.getElementById('theme-title').value.trim() || "There is no theme this week";
                const themeDescription = document.getElementById('theme-description').value.trim() || "There is no theme this week";
                
                const closeDate = new Date();
                closeDate.setDate(closeDate.getDate() + 7); // Add 7 days for submission period
                const finishDate = new Date(closeDate);
                finishDate.setDate(finishDate.getDate() + 7); // Add 7 days for voting period

                const closeDateString = closeDate.toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' });
                const finishDateString = finishDate.toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' });

                const sotwNumberWithPostfix = (number) => {
                    const suffixes = ["th", "st", "nd", "rd"];
                    const value = number % 100;
                    return number + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
                };

                const nextSotwNumber = parseInt(sotwNumber, 10) + 1;
                const nextSotwNumberWithPostfix = sotwNumberWithPostfix(nextSotwNumber);

                const template = `<!-- # This contest is over.

*[previous contest][contest prev] | [next contest][contest next]* -->

Hello and welcome to the **${nextSotwNumberWithPostfix}** edition of the Screenshot of the Week!

To start with, congratulations to the winner of the previous contest! [${acceptedAnswer.owner.display_name}][winning post]'s screenshot from [tag:${tags}] won with ${acceptedAnswer.score} upvotes!

[![Last week's winning screenshot one][winning screenshot]][winning screenshot]

---

To submit a screenshot, simply post it as an answer to this question, but please take note of the following:

- One screenshot per post, and one post per person, please!
- Limited picture modifications are allowed, such as cropping, simple filters, and blurring of identifying info such as names, but not adding other images or text.
- To ensure a fair playing field, please post screenshots you've taken yourself rather than ones you found online.
- Stack Exchange’s [Code of Conduct][code of conduct] still applies - so if it would be unacceptable to post normally, it’s unacceptable here.

Also, try to avoid pictures that include spoilers. We want everyone to be able to enjoy this contest, so the less spoilers the better.

### How long will the contest run?
We will accept submissions for a week, until ${closeDateString}, then have a second week-long period where only voting will be accepted. This is to give every submission, even those posted at the end of the first week, a chance to be voted on by everyone.

After the end of the second week, at ${finishDateString}, we will count upvotes only to determine the winning screenshot, which will be featured for a week on the main site's photo widget.

------------------------

# **This week's theme:** ${themeTitle}

${themeDescription}

As a reminder, we're always accepting suggestions for themed weeks, and have compiled that suggestion process into a [question of its own][themes collection]. Additionally, there is the [hall of fame][hall of fame] you can check out that contains all the previous contest winners.

  [contest prev]:       //meta.arqade.com/q/${lastPost.question_id}
  [contest next]:       //meta.arqade.com/q/17226

  [winning post]:       https://gaming.meta.stackexchange.com/a/${lastPost.question_id}/${acceptedAnswer.answer_id}
  [winning screenshot]: ${screenshotUrl}

  [code of conduct]:   //arqade.com/conduct
  [themes collection]: //meta.arqade.com/q/15029
  [hall of fame]:      //meta.arqade.com/q/14939`;

                document.getElementById('results').value = template.trim();
            } else {
                alert("No accepted answer found for the post.");
            }
        } else {
            alert("No accepted answer ID found for the post.");
        }
    } catch (error) {
        console.error("Error fetching data from Stack Exchange API:", error);
        alert("Failed to fetch data. Please try again later.");
    }
});

document.getElementById('copy-to-clipboard').addEventListener('click', () => {
    const results = document.getElementById('results');
    navigator.clipboard.writeText(results.value)
    const notification = document.createElement('div');
    notification.textContent = 'Results copied to clipboard!';
    notification.style.position = 'fixed';
    notification.style.bottom = '10px';
    notification.style.right = '10px';
    notification.style.backgroundColor = '#4caf50';
    notification.style.color = 'white';
    notification.style.padding = '10px';
    notification.style.borderRadius = '5px';
    notification.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
    document.body.appendChild(notification);

    setTimeout(() => {
        document.body.removeChild(notification);
    }, 3000);
});

const screenshotField = document.getElementById('screenshot');
let screenshotPopup;

screenshotField.addEventListener('mouseover', () => {
    const screenshotUrl = screenshotField.value.trim();
    if (screenshotUrl && screenshotUrl !== "N/A") {
        screenshotPopup = document.createElement('img');
        screenshotPopup.src = screenshotUrl;
        screenshotPopup.style.position = 'fixed';
        screenshotPopup.style.top = `${screenshotField.getBoundingClientRect().top + window.scrollY - 150}px`;
        screenshotPopup.style.left = `${screenshotField.getBoundingClientRect().left + window.scrollX}px`;
        screenshotPopup.style.width = '200px';
        screenshotPopup.style.height = 'auto';
        screenshotPopup.style.border = '1px solid #ccc';
        screenshotPopup.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
        screenshotPopup.style.backgroundColor = '#fff';
        document.body.appendChild(screenshotPopup);
    }
});

screenshotField.addEventListener('mouseout', () => {
    if (screenshotPopup) {
        document.body.removeChild(screenshotPopup);
        screenshotPopup = null;
    }
});

screenshotField.addEventListener('mousemove', (event) => {
    if (screenshotPopup) {
        screenshotPopup.style.top = `${event.clientY + 20}px`; // 20 pixels below the mouse
        screenshotPopup.style.left = `${event.clientX - screenshotPopup.offsetWidth / 2}px`; // Center horizontally
    }
});
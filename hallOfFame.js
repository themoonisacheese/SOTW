/**
 * Hall of Fame form handlers
 */

// Auto-populate post ID from sessionStorage on page load
document.addEventListener('DOMContentLoaded', () => {
    const postId = sessionStorage.getItem('winning_post_id');
    if (postId) {
        document.getElementById('hof-post-id').value = postId;
    }
});

document.getElementById('hof-generate').addEventListener('click', async () => {
    try {
        const postIdInput = document.getElementById('hof-post-id').value.trim();
        
        if (!postIdInput) {
            alert("Please enter a Post ID from the announcement generator.");
            return;
        }
        
        // Show loading state
        document.getElementById('hof-results').value = "Loading...";
        
        // Step 1: Fetch the announced post to get its contest number
        const postApiUrl = `https://api.stackexchange.com/2.3/questions/${postIdInput}?site=gaming.meta.stackexchange.com&filter=withbody`;
        let postData;
        try {
            postData = await fetchWithBackoff(postApiUrl, 'questions');
        } catch (e) {
            throw new Error(`API request failed for post ${postIdInput}. This post may not exist on gaming.meta.stackexchange.com, or you may have entered the wrong ID. (${e.message})`);
        }
        
        if (!postData.items || postData.items.length === 0) {
            throw new Error(`Post ${postIdInput} not found on gaming.meta.stackexchange.com. Make sure you're entering the ID of the new SOTW announcement post (e.g. the post for #164 which announces the winner of #163).`);
        }
        
        const announcedPost = postData.items[0];
        
        // Extract the contest number from the title (e.g., "Screenshot of the Week #145")
        const titleMatch = announcedPost.title.match(/#(\d+)/);
        if (!titleMatch) {
            throw new Error("Could not extract contest number from post title.");
        }
        
        const announcedContestNum = parseInt(titleMatch[1], 10);
        
        document.getElementById('hof-results').value = `Fetching existing hall of fame...\nAnnounced contest: #${announcedContestNum}`;
        
        // Step 2: Fetch existing Hall of Fame data
        const hofData = await fetchHallOfFameData();
        const lastContestNum = hofData.lastContestNum;
        
        if (announcedContestNum <= lastContestNum) {
            alert(`The announced contest #${announcedContestNum} is already in the hall of fame (which goes up to #${lastContestNum}).`);
            return;
        }
        
        document.getElementById('hof-results').value = `Found existing entries up to #${lastContestNum}\nFetching missing contests #${lastContestNum + 1}-#${announcedContestNum - 1}...\n\nDebug: Found ${hofData.entries.length} existing entries`;
        
        // Step 3: Fetch missing contests
        const missingContests = await fetchMissingContests(lastContestNum, announcedContestNum);
        
        if (missingContests.length === 0) {
            document.getElementById('hof-results').value = "No missing contests to add.";
            return;
        }
        
        document.getElementById('hof-results').value = `Found ${hofData.entries.length} existing entries\nFinding ${missingContests.length} missing contest(s)...\nAssembling hall of fame post...`;
        
        // Step 4: Assemble complete post
        const announcedPostLink = announcedPost.link || '';
        const announcedQuestionId = parseInt(announcedPost.question_id, 10);
        const markdown = assembleHallOfFamePage(hofData.entries, missingContests, hofData.browsingLinks, announcedContestNum, announcedPostLink, announcedQuestionId);
        
        document.getElementById('hof-results').value = markdown;
        
        // Show success notification
        showNotificationHOF('Hall of fame generated! Copy and paste into the Q14939 answer.');
        
    } catch (error) {
        console.error("Error generating hall of fame:", error);
        document.getElementById('hof-results').value = `Error: ${error.message}`;
        alert(`Error: ${error.message}`);
    }
});

document.getElementById('hof-copy-post').addEventListener('click', () => {
    const results = document.getElementById('hof-results');
    if (!results.value || results.value.includes("Loading") || results.value.includes("Error")) {
        alert("Please generate the hall of fame first.");
        return;
    }
    
    navigator.clipboard.writeText(results.value);
    showNotificationHOF('Hall of fame copied to clipboard!');
});

function showNotificationHOF(message) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.position = 'fixed';
    notification.style.bottom = '10px';
    notification.style.right = '10px';
    notification.style.backgroundColor = '#4caf50';
    notification.style.color = 'white';
    notification.style.padding = '10px';
    notification.style.borderRadius = '5px';
    notification.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
    notification.style.zIndex = '10000';
    document.body.appendChild(notification);

    setTimeout(() => {
        if (document.body.contains(notification)) {
            document.body.removeChild(notification);
        }
    }, 3000);
}

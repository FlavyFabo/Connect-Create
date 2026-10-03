USE mydb;

/*

     Business Requirement #1
    ----------------------------------------------------
    Purpose: Keep users engaged with their Creations

    Description: Normally users create a project with great enthusiasm making initial excitingly.
    However, after a while, progress and updates will stagnate and inevitably reach zero or in other
    words abandonment cluttering the database and leaving collaborators confused. There is nothing
    to remind owners or automatically update project status based on activity.

    Challenge: The system needs to identify inactive projects without being too
    aggressive, provide helpful reminders to re-engage users, and gracefully
    handle truly abandoned projects. We must balance keeping users accountable
    while not making them feel guilty or annoyed by constant nagging.

    Assumptions:
         - A Creation with no updates for 30 days is considered "Stalled"
         - A Creation with no updates for 60 days is considered "Archived"
         - Only Creations with Status "In Progress" are monitored
         - Owners receive one notification when status changes to "Stalled"

    Implementation Plan:
        1. Create a procedure to check inactivity
        2. Update Creation Status from In Progress to stalled if no updates in 30 days
        3. Update Creation Status from 'stalled' to 'Archived' if no updates in 60 days
        4. Create a trigger to send notification when a Creation gets stalled -- DO LATER
        5. Create a scheduled event that runs daily to and calls procedure
        6. Example of usage
 */

DELIMITER $$

DROP PROCEDURE IF EXISTS CHECK_INACTIVE_CREATIONS $$
CREATE PROCEDURE CHECK_INACTIVE_CREATIONS ()
BEGIN
    DECLARE stalled_count INT DEFAULT 0;
    DECLARE archived_count INT DEFAULT 0;
    DECLARE now DATETIME;

    SET now = NOW();

    -- mark stalled creations
    UPDATE Creation c
    SET c.status = 'Stalled'
    WHERE c.Status = 'In Progress'
    AND c.creation_id NOT IN (
        SELECT cu.creation_id
        FROM Creation_update cu
        WHERE cu.timestamp >= DATE_SUB(now, INTERVAL 30 DAY)
    );

    SET stalled_count = ROW_COUNT ();

    -- mark archived creations

    UPDATE Creation c
    SET c.status = 'Archived'
    WHERE c.status = 'Stalled'
    AND c.creation_id NOT IN (
        SELECT cu.creation_id
        FROM Creation_Update cu
        WHERE cu.timestamp >= DATE_SUB(now, INTERVAl 60 DAY)
    );

    SET archived_count = ROW_COUNT();

    -- return summary of what is marked stalled or archived

    SELECT
        stalled_count AS creations_marked_stalled,
        archived_count AS creations_marked_archived,
        now AS checked_at;
END $$

-- 5
DROP EVENT IF EXISTS DAILY_CHECK_INACTIVE_CREATIONS $$
CREATE EVENT IF NOT EXISTS DAILY_CHECK_INACTIVE_CREATIONS
ON SCHEDULE EVERY 1 DAY
STARTS TIMESTAMP(CURRENT_DATE, '00:00:00')
DO
BEGIN
    CALL CHECK_INACTIVE_CREATIONS();
END $$

-- 6
/*
CALL CHECK_INACTIVE_CREATIONS();
 */



/*

    Business Requirement #2
    ----------------------------------------------------
    Purpose: Automatically clean up expired pairing preferences

    Description: Users create pairing preferences when they want to find a match,
    but these preferences remain in the database forever, even after they've found
    someone or are no longer actively looking. This clutters the matching pool with
    inactive users, leading to poor match quality and wasted system resources trying
    to pair users who aren't actually available.

    Challenge: The system needs to identify which preferences are truly active vs
    stale, automatically remove old preferences, and ensure only users who are
    genuinely available get matched. Must balance keeping preferences long enough
    for matches to happen while removing abandoned preferences.

    Assumptions:
        - Pairing preferences expire after 24 hours of inactivity
        - If a user completes a pairing session, their preference is auto-removed
        - Users can manually reactivate by creating a new preference

    Implementation Plan:
        1. Create a scheduled event to clean up preferences older than 24 hours
        2. Provide example usage
 */

-- 1
DELIMITER $$

DROP EVENT IF EXISTS REMOVE_PREFERENCE_AFTER_PAIRING $$
CREATE EVENT REMOVE_PREFERENCE_AFTER_PAIRING
ON SCHEDULE EVERY 1 DAY
STARTS TIMESTAMP(CURRENT_DATE, '00:00:00')
DO
BEGIN
    DECLARE v_deleted_count INT DEFAULT 0;
    DECLARE now DATETIME;

    SET now = NOW();

    -- Delete preferences older than 24 hours
    DELETE FROM Pairing_Preference
    WHERE active_timestamp < DATE_SUB(NOW(), INTERVAL 24 HOUR);

    SET v_deleted_count = ROW_COUNT();

    SELECT
        v_deleted_count AS preferences_deleted,
        now AS cleaned_at;
END$$

DELIMITER ;

-- 2
-- Check current preferences
SELECT
    pairing_id,
    user_id,
    active_timestamp,
    TIMESTAMPDIFF(HOUR, active_timestamp, NOW()) AS hours_old
FROM Pairing_Preference;

-- Manually test the cleanup logic
DELETE FROM Pairing_Preference
WHERE active_timestamp < DATE_SUB(NOW(), INTERVAL 24 HOUR);

SELECT ROW_COUNT() AS deleted_count;

-- Check if the event is scheduled
SHOW EVENTS FROM mydb;

/*

    Business Requirement #3
    ----------------------------------------------------
    Purpose: Revive inactive connections and encourage meaningful interaction

    Description: Users connect with each other after successful pairing sessions
    or collaborations but these connections can sometimes become dead as in they're linked
    in the database but never actually interact again. This defeats the purpose of
    Connect-Create, which aims to help people build genuine relationships and
    collaborative networks. Without prompts to rengnage connections fade and
    users feel isolated desspite havning a network

    Challenge: we need to identify which conections are inactive and
    send gentle reminders to users

    Assumptions: - A connection is "inactive" if they haven't messaged each other
                   or collaborated in 14 days

    Implementation Plan:
        1. Create a function to check if a connection is inactive
        2. Create a procedure to identify and notify about inactive connections
        3. Create a scheduled event to run weekly checks
        4. Provide example usage
     */

DELIMITER $$

DROP FUNCTION IF EXISTS IS_CONNECTION_INACTIVE $$
CREATE FUNCTION IS_CONNECTION_INACTIVE(p_user1_id INT, p_user2_id INT)
RETURNS BOOLEAN
DETERMINISTIC
BEGIN
    DECLARE v_recent_messages INT DEFAULT 0;
    DECLARE v_recent_collaboration INT DEFAULT 0;
    DECLARE v_is_inactive INT DEFAULT 0;

    -- Check if they've messaged in the last 14 days
    SELECT COUNT(*) INTO v_recent_messages
    FROM Message
    WHERE ((sender_id = p_user1_id AND receiver_id = p_user2_id)
        OR (sender_id = p_user2_id AND receiver_id = p_user1_id))
    AND timestamp >= DATE_SUB(NOW(), INTERVAL 14 DAY);

    -- Check if they've collaborated on same Creation in last 14 days
    SELECT COUNT(*) INTO v_recent_collaboration
    FROM Creation_Collaborator cc1
    JOIN Creation_Collaborator cc2 ON cc1.creation_id = cc2.creation_id
    WHERE cc1.user_id = p_user1_id
    AND cc2.user_id = p_user2_id
    AND (cc1.join_date >= DATE_SUB(NOW(), INTERVAL 14 DAY)
         OR cc2.join_date >= DATE_SUB(NOW(), INTERVAL 14 DAY));

    -- If they've done either then connection is active
    IF v_recent_messages > 0 OR v_recent_collaboration > 0 THEN
        SET v_is_inactive = FALSE;
    END IF;

    RETURN v_is_inactive;
END$$

DELIMITER ;

-- 2
DELIMITER $$

DROP PROCEDURE IF EXISTS NOTIFY_INACTIVE_CONNECTIONS $$
CREATE PROCEDURE NOTIFY_INACTIVE_CONNECTIONS()
BEGIN
    DECLARE v_notification_count INT DEFAULT 0;
    DECLARE v_notification_id INT;

    -- Find all accepted connections that are inactive
    -- and send notifications to both users
    SELECT connection_id, user1_id, user2_id
    FROM Connection
    WHERE status = 'Accepted'
    AND NOTIFY_INACTIVE_CONNECTIONS(user1_id, user2_id) = TRUE
    INTO @conn_id, @user1, @user2;

    -- Create notification for each inactive connection
    INSERT INTO Notification (notification_type, timestamp)
    SELECT 'Inactive Connection', NOW()
    FROM Connection c
    WHERE c.status = 'Accepted'
    AND NOTIFY_INACTIVE_CONNECTIONS(c.user1_id, c.user2_id) = TRUE;

    -- Link notifications to users
    INSERT INTO User_Notification (notification_id, user_id, is_read)
    SELECT
        n.notification_id,
        c.user1_id,
        0
    FROM Connection c
    CROSS JOIN Notification n
    WHERE c.status = 'Accepted'
    AND NOTIFY_INACTIVE_CONNECTIONS(c.user1_id, c.user2_id) = TRUE
    AND n.notification_type = 'Inactive Connection'
    AND n.timestamp >= DATE_SUB(NOW(), INTERVAL 1 MINUTE);

    INSERT INTO User_Notification (notification_id, user_id, is_read)
    SELECT
        n.notification_id,
        c.user2_id,
        0
    FROM Connection c
    CROSS JOIN Notification n
    WHERE c.status = 'Accepted'
    AND NOTIFY_INACTIVE_CONNECTIONS(c.user1_id, c.user2_id) = TRUE
    AND n.notification_type = 'Inactive Connection'
    AND n.timestamp >= DATE_SUB(NOW(), INTERVAL 1 MINUTE);

    SET v_notification_count = ROW_COUNT();

    SELECT
        v_notification_count AS notifications_sent,
        NOW() AS checked_at;
END$$




-- 3
DELIMITER $$
DROP EVENT IF EXISTS WEEKLY_CONNECTION_ACTIVITY_CHECK $$
CREATE EVENT IF NOT EXISTS WEEKLY_CONNECTION_ACTIVITY_CHECK
ON SCHEDULE EVERY 14 DAY
STARTS TIMESTAMP(CURRENT_DATE,'00:00:00')
DO
BEGIN
    CALL NOTIFY_INACTIVE_CONNECTIONS ();
END $$

DELIMITER ;



-- 4
-- SELECT IS_CONNECTION_INACTIVE(1, 4) AS is_inactive;

/*

    Business Requirement #4
    ----------------------------------------------------
    Purpose: Create a quick summary of a user's platform activity

    Description: When viewing a user's profile, it's difficult to gauge their
    level of engagement. Are they an active creator, a frequent collaborator,
    or a new user? We need a way to take a quick glance of key metrics that can
    be pulled up for any user.

    Challenge: This data is scattered across multiple tables. We need to efficiently
    query my tables and aggregate counts into a single summary view.

    Assumptions:
         NONE

    Implementation Plan:
        1. Create a stored procedure to query 5-6 tables counting key metrics
        2. Provide an example usage.
 */

-- 1
DELIMITER $$

DROP PROCEDURE IF EXISTS GET_USER_ACTIVITY_STATS $$
CREATE PROCEDURE GET_USER_ACTIVITY_STATS(IN p_user_id INT)
BEGIN
    SELECT
        (SELECT COUNT(*)
         FROM Creation
         WHERE owner_id = p_user_id) AS creations_owned,

        (SELECT COUNT(*)
         FROM Creation_Collaborator
         WHERE user_id = p_user_id) AS creations_joined,

        (SELECT COUNT(*)
         FROM Connection
         WHERE (user1_id = p_user_id OR user2_id = p_user_id)
           AND status = 'Accepted') AS accepted_connections,

        (SELECT COUNT(*)
         FROM Creation_Update
         WHERE user_id = p_user_id) AS total_updates_posted,

        (SELECT COUNT(*)
         FROM Pairing_Session
         WHERE (user1_id = p_user_id OR user2_id = p_user_id)
           AND end_time IS NOT NULL) AS pairing_sessions_completed;
END $$

DELIMITER ;

-- 2. Example usage
-- CALL GET_USER_ACTIVITY_STATS(1);

/*

    Business Requirement #5
    ----------------------------------------------------
    Purpose: Identify trending skills and project topics on the platform

    Description: There is no way to identify what skill tags are popular
    as well as topics for creations. We will be making a top 5 chart.

    Challenge: The data is in two separate junction tables. We need
    to query, join, group, and count both, then present them as
    two  lists

    Assumptions:
         - We only want the Top 5 results for each list
         - Popular Tags are counted from their use in `Creation_Tag`
         - Desired Skills are counted from `Preference_Desired_Skills`

    Implementation Plan:
        1. Create a procedure to get a top 5 most popular skills and project types
        2. make a CTE for tags
        3. make a CTE for skills
        4. Provide example usage.
*/
DELIMITER $$

-- 1
DROP PROCEDURE IF EXISTS GET_POPULARITY_REPORT $$
CREATE PROCEDURE GET_POPULARITY_REPORT ()
BEGIN
    -- 2
    WITH TAG_COUNTS_CTE AS (
        -- get top 5 most used tags
        SELECT
            t.tag_name,
            COUNT(ct.creation_id) AS use_count
        FROM Creation_Tag ct
        JOIN Tag t ON ct.tag_id = t.tag_id
        GROUP BY t.tag_name
        ORDER BY use_count DESC
        LIMIT 5
    )
    -- returns result
    SELECT tag_name, use_count FROM TAG_COUNTS_CTE;
    -- 3
    WITH SKILLS_COUNT_CTE AS (
        -- get top 5 most wanted skills
        SELECT
            s.skill_name,
            COUNT(pds.pairing_id) AS request_count
        FROM Preference_Desired_Skills pds
        JOIN Skill s ON pds.skill_id = s.skill_id
        GROUP BY s.skill_name
        ORDER BY request_count DESC
        LIMIT 5
    )
    -- This SELECT returns the *second* result set
    SELECT skill_name, request_count FROM SKILLS_COUNT_CTE;

END $$

DELIMITER ;

-- 4
-- CALL GET_POPULARITY_REPORT ();

/*

    Business Requirement #6
    ----------------------------------------------------
    Purpose: Automatically scrub sensitive PII
    from user generated ai content to make privacy and security and better.

    Description: Users might accidentally share personal data, like their
    email address, in a message. We must prevent this sensitive data
    from being stored in plain text, where it could be a liability if
    the database is ever breached.

    Challenge: The system needs to intercept and clean the data
    before it's written to the database. A trigger oughta to it

    Assumptions:
         - NONE

    Implementation Plan:
        1. Create a trigger to scrub the messgage content
        2. Provide an example usage.
 */

 -- 1
DELIMITER $$
DROP TRIGGER IF EXISTS SCRUB_MESSAGE_CONTENT $$
CREATE TRIGGER SCRUB_MESSAGE_CONTENT BEFORE INSERT ON Message
FOR EACH ROW
BEGIN
    SET NEW.content = REGEXP_REPLACE(
        NEW.content,
        '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
        '[REDACTED_EMAIL]'
    );

END $$

DELIMITER ;

-- 2
/*
INSERT INTO Message (content, timestamp, sender_id, receiver_id)
    VALUES ('Hey Bob, my email is alice@example.com, hit me up!', NOW(), 1, 2);

    SELECT * FROM Message WHERE message_id = LAST_INSERT_ID();
 */


/*

    Business Requirement #7
    ----------------------------------------------------
    Purpose: Suggest local connections to help users find collaborators
    in their same city.

    Description: A user wants to see a list of other registered users
    who are in their same city. This encourages real world collaboration
    and connection

    Challenge: I need to make a query that must first find the user's location, then find
    other users in that location.

    Assumptions:
         - "Local" is defined as having the exact same location_id
         - We must exclude the user themselves from the results.
         - We must exclude any user who already has an 'Accepted' or
           Pending connection with the user.

    Implementation Plan:
        1. Create a stored procedure to find local connections
        2. Provide example usage.
 */

DELIMITER $$

DROP PROCEDURE IF EXISTS FIND_LOCAL_CONNECTIONS $$
CREATE PROCEDURE FIND_LOCAL_CONNECTIONS(IN p_user_id INT)
BEGIN
    DECLARE v_location_id INT;

    -- get user's location
    SELECT location_id into v_location_id
    FROM Registered_User
        WHERE user_id = p_user_id;

    -- find other users in that location
    SELECT
        ru.user_id,
        u.real_name,
        c.city_name
    FROM Registered_User ru
    JOIN User u ON ru.user_id = u.user_id
    JOIN Location l ON ru.location_id = l.location_id
    JOIN Cities c ON l.cities_city_id = c.city_id
    WHERE ru.location_id = v_location_id
      AND ru.user_id <> p_user_id; -- Exclude the user themselves

END $$
DELIMITER ;

-- 2
-- CALL FIND_LOCAL_CONNECTIONS(1);


/*

    Business Requirement #8
    ----------------------------------------------------
    Purpose: Limit the number of active projects per each type of account

    Description: In order to encourage users to upgrade to 'Pro' accounts we
    need to limit 'Free' users to a maximum of 3 "In Progress" projects.
    We need to automatically block them from creating a fourth.

    Challenge: We need to check this before a Creation is made
    . It requires checking the user's account type and their current
    project count in realtime

    Assumptions:
         - The limit is 3 projects
    Implementation Plan:
        1. Create a trigger to limit free tier to 3 Creations
        2. example usage provided
 */

DELIMITER $$

DROP TRIGGER IF EXISTS ENFORCE_PROJECT_LIMITS $$
CREATE TRIGGER ENFORCE_PROJECT_LIMITS BEFORE INSERT ON Creation
FOR EACH ROW
BEGIN
    DECLARE v_is_free_user BOOLEAN DEFAULT FALSE;
    DECLARE v_project_count INT DEFAULT 0;

    -- Check if the user is in free acount
    SELECT TRUE INTO v_is_free_user
    FROM User_Account ua
    JOIN Account a ON ua.account_id = a.account_id
    WHERE ua.user_id = NEW.owner_id
      AND a.type = 'Free'
      -- make sure they dont have a pro or student accounts
      AND NOT EXISTS (
          SELECT 1
          FROM User_Account ua2
          JOIN Account a2 ON ua2.account_id = a2.account_id
          WHERE ua2.user_id = NEW.owner_id
            AND a2.type IN ('Pro', 'Student')
      )
    LIMIT 1;

    -- now check project count
    IF v_is_free_user = TRUE THEN
        -- Count their *current* "In Progress" projects
        SELECT COUNT(*) INTO v_project_count
        FROM Creation
        WHERE owner_id = NEW.owner_id
          AND status = 'In Progress';

        -- If they are at the limit then we block the insert
        IF v_project_count >= 3 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Free accounts are limited to 3 "In Progress" projects. Please archive one or upgrade your account.';
        END IF;
    END IF;
END $$

-- 2
/*
INSERT INTO Creation (title, description, status, owner_id)
VALUES ('Bob Project 1', 'Desc...', 'In Progress', 2);

-- This should also work.
INSERT INTO Creation (title, description, status, owner_id)
    VALUES ('Bob Project 2', 'Desc...', 'In Progress', 2);

-- This should also work (now at 3).
INSERT INTO Creation (title, description, status, owner_id)
VALUES ('Bob Project 3', 'Desc...', 'In Progress', 2);

-- this one should be BLOCKED
INSERT INTO Creation (title, description, status, owner_id)
VALUES ('Bob Project 4', 'Desc...', 'In Progress', 2);
*/

/*

    Business Requirement #9
    ----------------------------------------------------
    Purpose: Monitor Artificial Interlligence usage for cost analysis or other
    useful reasons

    Description: My `Ai_Interaction` table is logging every prompt
    and response. We need a summary report to make sense of this data,
    identify who is using it the most, and see if usage is growing.

    Challenge: The log data is just a long list of rows. We need to
    aggregate this data into a couple of useful summaries

    Assumptions:
         - perhaps have the top 5 most active users.
         - We want to see the daily usage trend for the last 30 days.

    Implementation Plan:
        1. Create a stored procedure to get ai usage anlytics
        5. Provide example usage
 */

 -- 1
DELIMITER  $$

DROP PROCEDURE IF EXISTS GET_AI_USAGE_REPORT $$
CREATE PROCEDURE GET_AI_USAGE_REPORT()
BEGIN
    -- get the top 5 users
    SELECT
        u.real_name,
        COUNT(ai.ai_int_id) AS total_prompts
    FROM Ai_Interaction ai
    JOIN User u ON ai.user_id = u.user_id
    GROUP BY u.real_name
    ORDER BY total_prompts DESC
    LIMIT 5;

    -- here we get the last 30 days trends
    SELECT
        DATE(timestamp) AS interaction_date,
        COUNT(ai_int_id) AS total_prompts_on_date
    FROM Ai_Interaction
    WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY interaction_date
    ORDER BY interaction_date ASC;
END $$

DELIMITER ;

-- 2
/*
CALL GET_AI_USAGE_REPORT();
 */
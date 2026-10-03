SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

DROP TABLE IF EXISTS Comment;
DROP TABLE IF EXISTS Message;
DROP TABLE IF EXISTS Creation_Update;
DROP TABLE IF EXISTS Creation_Collaborator;
DROP TABLE IF EXISTS Creation_Tag;
DROP TABLE IF EXISTS Team;
DROP TABLE IF EXISTS Workspace;
DROP TABLE IF EXISTS Media;
DROP TABLE IF EXISTS Preference_Project_Ideas;
DROP TABLE IF EXISTS Preference_Desired_Skills;
DROP TABLE IF EXISTS Pairing_Preference;
DROP TABLE IF EXISTS Pairing_Session;
DROP TABLE IF EXISTS Connection;
DROP TABLE IF EXISTS Ai_Interaction;
DROP TABLE IF EXISTS User_Location;
DROP TABLE IF EXISTS User_Notification;
DROP TABLE IF EXISTS User_Account;
DROP TABLE IF EXISTS Tag;
DROP TABLE IF EXISTS Skill;
DROP TABLE IF EXISTS Notification;
DROP TABLE IF EXISTS Account;
DROP TABLE IF EXISTS Creation;
DROP TABLE IF EXISTS Registered_User;
DROP TABLE IF EXISTS Location;
DROP TABLE IF EXISTS Cities;
DROP TABLE IF EXISTS User;

DROP SCHEMA IF EXISTS mydb;
CREATE SCHEMA IF NOT EXISTS mydb DEFAULT CHARACTER SET utf8;
USE mydb;

-- User
CREATE TABLE User (
  user_id INT NOT NULL AUTO_INCREMENT,
  tracking_id VARCHAR(45) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  real_name VARCHAR(100),
  PRIMARY KEY (user_id),
  UNIQUE INDEX tracking_id_unique (tracking_id ASC)
);

-- Cities
CREATE TABLE Cities (
  city_id INT NOT NULL AUTO_INCREMENT,
  city_name VARCHAR(100) NOT NULL,
  country VARCHAR(100) NOT NULL,
  PRIMARY KEY (city_id)
);

-- Location
CREATE TABLE Location (
  location_id INT NOT NULL AUTO_INCREMENT,
  cities_city_id INT NOT NULL,
  PRIMARY KEY (location_id),
  INDEX fk_location_cities_idx (cities_city_id ASC),
  CONSTRAINT fk_location_cities FOREIGN KEY (cities_city_id)
    REFERENCES Cities (city_id)
);

-- Registered_User
CREATE TABLE Registered_User (
  user_id INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  bio TEXT,
  location_id INT NULL,
  PRIMARY KEY (user_id),
  UNIQUE INDEX email_unique (email ASC),
  INDEX fk_registered_location_idx (location_id ASC),
  CONSTRAINT fk_registered_user_user FOREIGN KEY (user_id)
    REFERENCES User (user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_registered_user_location FOREIGN KEY (location_id)
    REFERENCES Location (location_id)
    ON DELETE SET NULL
);

-- Creation
CREATE TABLE Creation (
  creation_id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(45),
  owner_id INT NOT NULL,
  PRIMARY KEY (creation_id),
  INDEX fk_creation_user_idx (owner_id ASC),
  CONSTRAINT fk_creation_registered_user FOREIGN KEY (owner_id)
    REFERENCES Registered_User (user_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Account
CREATE TABLE Account (
  account_id INT NOT NULL AUTO_INCREMENT,
  type VARCHAR(45) NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (account_id)
);

-- Notification
CREATE TABLE Notification (
  notification_id INT NOT NULL AUTO_INCREMENT,
  notification_type VARCHAR(45) NOT NULL,
  timestamp DATETIME NOT NULL,
  PRIMARY KEY (notification_id)
);

-- Skill
CREATE TABLE Skill (
  skill_id INT NOT NULL AUTO_INCREMENT,
  skill_name VARCHAR(100) NOT NULL,
  PRIMARY KEY (skill_id),
  UNIQUE INDEX skill_name_unique (skill_name ASC)
);

-- Tag
CREATE TABLE Tag (
  tag_id INT NOT NULL AUTO_INCREMENT,
  tag_name VARCHAR(45) NOT NULL,
  PRIMARY KEY (tag_id),
  UNIQUE INDEX tag_name_unique (tag_name ASC)
);

-- User_Account
CREATE TABLE User_Account (
  user_id INT NOT NULL,
  account_id INT NOT NULL,
  PRIMARY KEY (user_id, account_id),
  INDEX fk_user_account_account_idx (account_id ASC),
  CONSTRAINT fk_user_account_user FOREIGN KEY (user_id)
    REFERENCES Registered_User (user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_user_account_account FOREIGN KEY (account_id)
    REFERENCES Account (account_id)
    ON DELETE CASCADE
);

-- User_Notification
CREATE TABLE User_Notification (
  notification_id INT NOT NULL,
  user_id INT NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (notification_id, user_id),
  INDEX fk_user_notification_user_idx (user_id ASC),
  CONSTRAINT fk_user_notification_notif FOREIGN KEY (notification_id)
    REFERENCES Notification (notification_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_user_notification_user FOREIGN KEY (user_id)
    REFERENCES Registered_User (user_id)
    ON DELETE CASCADE
);

-- User_Location
CREATE TABLE User_Location (
  user_id INT NOT NULL,
  location_id INT NOT NULL,
  set_date DATE NOT NULL,
  PRIMARY KEY (user_id, location_id),
  INDEX fk_user_location_loc_idx (location_id ASC),
  CONSTRAINT fk_user_location_user FOREIGN KEY (user_id)
    REFERENCES Registered_User (user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_user_location_location FOREIGN KEY (location_id)
    REFERENCES Location (location_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Ai_Interaction
CREATE TABLE Ai_Interaction (
  ai_int_id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  prompt TEXT,
  response TEXT,
  timestamp DATETIME NOT NULL,
  PRIMARY KEY (ai_int_id),
  INDEX fk_ai_interaction_user_idx (user_id ASC),
  CONSTRAINT fk_ai_interaction_user FOREIGN KEY (user_id)
    REFERENCES Registered_User (user_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Connection
CREATE TABLE Connection (
  connection_id INT NOT NULL AUTO_INCREMENT,
  user1_id INT NOT NULL,
  user2_id INT NOT NULL,
  status VARCHAR(45) NOT NULL,
  PRIMARY KEY (connection_id),
  INDEX fk_conn_user1_idx (user1_id ASC),
  INDEX fk_conn_user2_idx (user2_id ASC),
  CONSTRAINT fk_connection_user1 FOREIGN KEY (user1_id)
    REFERENCES Registered_User (user_id),
  CONSTRAINT fk_connection_user2 FOREIGN KEY (user2_id)
    REFERENCES Registered_User (user_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Pairing_Session
CREATE TABLE Pairing_Session (
  session_id INT NOT NULL AUTO_INCREMENT,
  user1_id INT NOT NULL,
  user2_id INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NULL,
  PRIMARY KEY (session_id),
  INDEX fk_ps_user1_idx (user1_id ASC),
  INDEX fk_ps_user2_idx (user2_id ASC),
  CONSTRAINT fk_ps_user1 FOREIGN KEY (user1_id)
    REFERENCES Registered_User (user_id),
  CONSTRAINT fk_ps_user2 FOREIGN KEY (user2_id)
    REFERENCES Registered_User (user_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Pairing_Preference
CREATE TABLE Pairing_Preference (
  pairing_id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  active_timestamp DATETIME NOT NULL,
  PRIMARY KEY (pairing_id),
  INDEX fk_pp_user_idx (user_id ASC),
  CONSTRAINT fk_pp_user FOREIGN KEY (user_id)
    REFERENCES Registered_User (user_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Preference_Desired_Skills
CREATE TABLE Preference_Desired_Skills (
  pairing_id INT NOT NULL,
  skill_id INT NOT NULL,
  PRIMARY KEY (pairing_id, skill_id),
  INDEX fk_pds_skill_idx (skill_id ASC),
  CONSTRAINT fk_preference_desired_skills_pairing FOREIGN KEY (pairing_id)
    REFERENCES Pairing_Preference (pairing_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_preference_desired_skills_skill FOREIGN KEY (skill_id)
    REFERENCES Skill (skill_id)
    ON DELETE CASCADE
);

-- Preference_Project_Ideas
CREATE TABLE Preference_Project_Ideas (
  idea_id INT NOT NULL AUTO_INCREMENT,
  pairing_id INT NOT NULL,
  project_idea_text TEXT NOT NULL,
  PRIMARY KEY (idea_id),
  INDEX fk_ppi_pref_idx (pairing_id ASC),
  CONSTRAINT fk_ppi_pref FOREIGN KEY (pairing_id)
    REFERENCES Pairing_Preference (pairing_id)
    ON DELETE CASCADE
);

-- Media
CREATE TABLE Media (
  media_id INT NOT NULL AUTO_INCREMENT,
  creation_id INT NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  media_type VARCHAR(45),
  PRIMARY KEY (media_id),
  INDEX fk_media_creation_idx (creation_id ASC),
  CONSTRAINT fk_media_creation FOREIGN KEY (creation_id)
    REFERENCES Creation (creation_id)
    ON DELETE CASCADE
);

-- Workspace
CREATE TABLE Workspace (
  workspace_id INT NOT NULL AUTO_INCREMENT,
  creation_id INT NOT NULL,
  document_content LONGTEXT,
  last_edited_date DATETIME,
  PRIMARY KEY (workspace_id),
  UNIQUE INDEX creation_id_unique (creation_id ASC),
  CONSTRAINT fk_workspace_creation FOREIGN KEY (creation_id)
    REFERENCES Creation (creation_id)
    ON DELETE CASCADE
);

-- Team
CREATE TABLE Team (
  team_id INT NOT NULL AUTO_INCREMENT,
  team_name VARCHAR(100) NOT NULL,
  creation_id INT NOT NULL,
  PRIMARY KEY (team_id),
  UNIQUE INDEX team_name_unique (team_name ASC),
  UNIQUE INDEX creation_id_unique (creation_id ASC),
  CONSTRAINT fk_team_creation FOREIGN KEY (creation_id)
    REFERENCES Creation (creation_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Creation_Tag
CREATE TABLE Creation_Tag (
  creation_tag_id INT NOT NULL AUTO_INCREMENT,
  creation_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (creation_tag_id),
  INDEX fk_ct_creation_idx (creation_id ASC),
  INDEX fk_ct_tag_idx (tag_id ASC),
  CONSTRAINT fk_ct_creation FOREIGN KEY (creation_id)
    REFERENCES Creation (creation_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ct_tag FOREIGN KEY (tag_id)
    REFERENCES Tag (tag_id)
    ON DELETE CASCADE
);

-- Creation_Collaborator
CREATE TABLE Creation_Collaborator (
  history_id INT NOT NULL AUTO_INCREMENT,
  creation_id INT NOT NULL,
  user_id INT NOT NULL,
  role VARCHAR(45) NOT NULL,
  join_date DATE NOT NULL,
  PRIMARY KEY (history_id),
  INDEX fk_cc_creation_idx (creation_id ASC),
  INDEX fk_cc_user_idx (user_id ASC),
  CONSTRAINT fk_creation_collaborator_creation FOREIGN KEY (creation_id)
    REFERENCES Creation (creation_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_creation_collaborator_user FOREIGN KEY (user_id)
    REFERENCES Registered_User (user_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);


-- Creation_Update
CREATE TABLE Creation_Update (
  update_id INT NOT NULL AUTO_INCREMENT,
  creation_id INT NOT NULL,
  user_id INT NOT NULL,
  content TEXT,
  timestamp DATETIME NOT NULL,
  PRIMARY KEY (update_id),
  INDEX fk_cu_creation_idx (creation_id ASC),
  INDEX fk_cu_user_idx (user_id ASC),
  CONSTRAINT fk_cu_creation FOREIGN KEY (creation_id)
    REFERENCES Creation (creation_id),
  CONSTRAINT fk_cu_user FOREIGN KEY (user_id)
    REFERENCES Registered_User (user_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Message
CREATE TABLE Message (
  message_id INT NOT NULL AUTO_INCREMENT,
  content TEXT NOT NULL,
  timestamp DATETIME NOT NULL,
  sender_id INT NULL,
  receiver_id INT NULL,
  PRIMARY KEY (message_id),
  INDEX fk_msg_sender_idx (sender_id ASC),
  INDEX fk_msg_receiver_idx (receiver_id ASC),
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id)
    REFERENCES Registered_User (user_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_msg_receiver FOREIGN KEY (receiver_id)
    REFERENCES Registered_User (user_id)
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- Comment
CREATE TABLE Comment (
  comment_id INT NOT NULL AUTO_INCREMENT,
  update_id INT NOT NULL,
  user_id INT NOT NULL,
  content TEXT NOT NULL,
  timestamp DATETIME NOT NULL,
  PRIMARY KEY (comment_id),
  INDEX fk_comment_update_idx (update_id ASC),
  INDEX fk_comment_user_idx (user_id ASC),
  CONSTRAINT fk_comment_update FOREIGN KEY (update_id)
    REFERENCES Creation_Update (update_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_comment_user FOREIGN KEY (user_id)
    REFERENCES Registered_User (user_id)
    ON DELETE CASCADE
);

-- Pairing_Session_Metrics
CREATE TABLE Pairing_Session_Metrics (
    metric_id INT NOT NULL AUTO_INCREMENT,
    session_id INT NOT NULL,
    success_status ENUM('Successful', 'Unsuccessful', 'Pending') DEFAULT 'Pending',
    failure_reason VARCHAR(100),
    success_indicator VARCHAR(100),
    session_duration_minutes INT,
    evaluated_at DATETIME,
    PRIMARY KEY (metric_id),
    UNIQUE INDEX session_id_unique (session_id ASC),
    CONSTRAINT fk_metrics_session FOREIGN KEY (session_id)
        REFERENCES Pairing_Session (session_id)
        ON DELETE CASCADE
);

SET SQL_MODE=@OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;

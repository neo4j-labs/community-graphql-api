import moment from 'moment';
import * as neo4j from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

let topCommunityOpenSourceProjects_cached,
    topCommunityBlogsAndContent_cached,
    thisWeekInNeo4j_cached,
    topNewCertifiedDevelopers_cached;


const updateDriver = () => {
  driver = neo4j.driver(
    process.env.NEO4J_URI || "bolt://localhost:7687",
    neo4j.auth.basic(
      process.env.NEO4J_USER || "neo4j",
      process.env.NEO4J_PASSWORD || "neo4j"
    )
  )
  return driver;
}

let driver = updateDriver();

export const typeDefs = `
type Twin4jContent {
  featuredCommunityMember: CommunityMember
  date: String
  url: String
  text: String
  features: [Twin4jFeature]
  articles: [Twin4jArticle]
  topItems: [Twin4jItem]
}

type Twin4jItem {
  tag: String
  url: String
}

type Twin4jFeature {
  tag: String
  url: String
}

type Twin4jArticle {
  tag: String
  url: String
}

type CommunityMember {
  image: String
}

type CommunityBlog {
  title: String
  url: String
  author: DiscourseUser
}

type DiscourseUser {
  name: String
  screenName: String
  avatar: String
}

type CertifiedDeveloper {
  developer: DiscourseUser
  certificationDate: String
}

type CommunityOpenSourceProject {
  title: String
  url: String
  description: String
  releaseDate: String
  language: String
  author: DiscourseUser
}

type Query {
  topCommunityOpenSourceProjects(first: Int = 10): [CommunityOpenSourceProject]
  topCommunityBlogsAndContent(first: Int = 10): [CommunityBlog]
  topNewCertifiedDevelopers(first: Int = 10): [CertifiedDeveloper]
  thisWeekInNeo4j: Twin4jContent
}
`;

export const resolvers = {
  Query: {
    topCommunityOpenSourceProjects: (_, params, context) => {
      let session = driver.session();

      // FIXME: This query is fragile, depending 
      let query = `
      MATCH (u:DiscourseUser)-[:POSTED_CONTENT]->(t:DiscourseTopic {categoryId: 9})
      WHERE t.approved AND NOT "Exclude" IN labels(t)
      WITH *, 1.0 * (duration.inSeconds(datetime(), t.createdAt)).seconds/10000 AS ago
      WITH u, t, (10.0 * t.rating + coalesce(t.likeCount, 0) + coalesce(t.replyCount, 0))/(ago^2) AS score
      WITH u, t, score ORDER BY score DESC
      WITH u, COLLECT({t:t, score:score}) AS topics
      WITH u AS du, topics[0].t AS repo
      RETURN du, repo {.title, pushed: repo.createdAt, description: "", language: "", url: "https://community.neo4j.com/t/" + repo.slug }
      ORDER BY repo.score DESC LIMIT toInteger(ceil(toInteger($first)/2.0))

      UNION
 
      MATCH (du:DiscourseUser)-[*0..2]-(ghu:User)-[:CREATED]->(g:GitHub)
      WHERE NOT "Exclude" IN labels(g) AND exists(g.updated_at) AND g.favorites > 0
      WITH DISTINCT du, g
      ORDER BY g.updated_at DESC
      WITH du, COLLECT(g)[0] AS repo
      RETURN du, repo {.title, .language, .url, .description, .pushed} ORDER BY repo.updated_at DESC LIMIT toInteger(floor($first/2.0))`;

      return session.run(query, params)
      .then( result => {
        const resData = result.records.map(record => {

          let user = record.get("du").properties,
            repo = record.get("repo");

          return {
            title: repo.title,
            language: repo.language,
            url: repo.url,
            description: repo.description,
            releaseDate: repo.pushed,
            author: {
              name: user.name,
              screenName: user.screenName,
              avatar: getAvatarUrl(user.avatarTemplate)
            }
          }
        })

        topCommunityOpenSourceProjects_cached = resData;

        return resData;
      })
      .catch(error => {
        console.log(new Date());
        console.log(error);
        updateDriver();
        return topCommunityOpenSourceProjects_cached;
      })
      .finally( ()=> {
        session.close();
      })
    },
    topCommunityBlogsAndContent: (_, params, context) => {

      let session = driver.session();

      // FIXME: inefficent query - computes score for all topics
      let query = `
      MATCH (u:DiscourseUser)-[:POSTED_CONTENT]->(t:DiscourseTopic {categoryId: 68})
      ,
      (u)-[:POSTED_CONTENT]->(p:DiscoursePost {number:1})-[PART_OF]->(t)
      WHERE t.approved AND NOT "Exclude" IN labels(t)
      WITH *, 1.0 * (duration.inSeconds(datetime(), t.createdAt)).seconds/10000 AS ago
      WITH u, t, (10.0 * t.rating + coalesce(t.likeCount, 0) + coalesce(t.replyCount, 0))/(ago^2) AS score
      WITH u, t, score ORDER BY score DESC
      WITH u, COLLECT({t:t, score:score}) AS topics
    RETURN u, topics[0].t AS topic ORDER BY topics[0].score DESC LIMIT toInteger($first)
      `,
        baseUrl = 'https://community.neo4j.com/';

      return session.run(query, params)
      .then( result => {
        const resData = result.records.map(record => {

          let user = record.get("u").properties,
            topic = record.get("topic").properties;

          return {
            title: topic.title,
            url: baseUrl + "t/" + topic.slug,
            author: {
              name: user.name,
              screenName: user.screenName,
              avatar: getAvatarUrl(user.avatarTemplate)
            }
          }
        })

        topCommunityBlogsAndContent_cached = resData;
        return resData;

      })
      .catch(error => {
        console.log(error);
        updateDriver()
        return topCommunityBlogsAndContent_cached;
      })
      .finally( ()=> {
        session.close();
      })
    },
    topNewCertifiedDevelopers: (_, params, context) => {

      let session = driver.session();

      let query = `
      MATCH (du:DiscourseUser)<-[:DISCOURSE_ACCOUNT]-(u:User)-[:TOOK]->(c:Certification {passed: true})
      WITH * ORDER BY c.finished
      WITH du, u, COLLECT(c) AS exams
      RETURN du, u, exams[0] AS c ORDER BY du.id DESC LIMIT toInteger($first)
      `;

      return session.run(query, params)
      .then( result => {
        const resData = result.records.map(record => {

          const user = record.get("du").properties,
            exam = record.get("c").properties;

          return {
            certificationDate: (new Date(exam.finished*1000)).toString(),
            developer: {
              name: user.name,
              screenName: user.screenName,
              avatar: getAvatarUrl(user.avatarTemplate)
            }
          }
        })

        topNewCertifiedDevelopers_cached = resData;
        return resData;
      })
      .catch(error => {
        console.log(error);
        updateDriver();
        return topNewCertifiedDevelopers_cached;
      })
      .finally( ()=> {
        session.close();
      })
    },
    thisWeekInNeo4j: (_, params, context) => {

      let session = driver.session();

      // FIXME: We might be able to connect the DiscourseUser to the featured community member
      //        but not currently using that data. 
      let query = `
      MATCH (t:TWIN4j)
      WITH t ORDER BY t.date DESC LIMIT 1 
      //OPTIONAL MATCH (t)-[:FEATURED]->(u:User)
      OPTIONAL MATCH (t)-[:CONTAINS_TAG]->(article:TWIN4jTag)
      WHERE article.anchor STARTS WITH "articles"
      WITH t, COLLECT(article) AS articles
      OPTIONAL MATCH (t)-[:CONTAINS_TAG]->(feature:TWIN4jTag)
      WHERE feature.anchor STARTS WITH "features"
      RETURN t, COLLECT(feature) AS features, articles
      `;

      return session.run(query, params)
      .then( result => {

        var record = result.records[0];

          const twin4j = record.get("t").properties;

          const features = record.get("features").map((fn) => {
                  const f = fn.properties;
                  return {
                    url: twin4j.link + '#' + f.anchor,
                    tag: f.tag
                  }
                }),
                articles = record.get("articles").map( (an) => {
                  const a = an.properties;
                  return {
                    url: twin4j.link + '#' + a.anchor,
                    tag: a.tag
                  }
                });

          const topItems = [...features, ...articles].slice(0,5);

          

          const resData =  {
            date: moment(new Date(twin4j.date)).format('Do MMM YYYY'),
            url: twin4j.link,
            text: twin4j.summaryText,
            featuredCommunityMember: {
              image: twin4j.image 
            },
            features: features,
            articles: articles,
            topItems: topItems
          };
          
          thisWeekInNeo4j_cached = resData;
          return resData;
        })
      .catch(error => {
        console.log(error);
        updateDriver();
        return thisWeekInNeo4j_cached;
      })
      .finally( ()=> {
        session.close();
      })

    }
  }
};

const getAvatarUrl = (urlTemplate) => {
  const baseUrl = "https://community.neo4j.com";

  if (urlTemplate.startsWith("http")) {
    return urlTemplate.replace("{size}", 50)
  } else {
    return (baseUrl + urlTemplate).replace("{size}", 50)
  }

};

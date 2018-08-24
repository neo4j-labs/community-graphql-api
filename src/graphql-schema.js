import moment from 'moment';

export const typeDefs = `
type Twin4jContent {
  featuredCommunityMember: CommunityMember
  date: String
  url: String
  text: String
  features: [Twin4jFeature]
  articles: [Twin4jArticle]
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
      let session = context.driver.session();

      // FIXME: This query is fragile, depending 
      let query = `
      MATCH (du:DiscourseUser)-[*0..2]-(ghu:User)-[:CREATED]->(g:GitHub)
      WHERE NOT "Exclude" IN labels(g)
      WITH du, g
      ORDER BY g.updated_at DESC
      WITH du, COLLECT(g)[0] AS repo
      RETURN du, repo ORDER BY repo.updated_at DESC LIMIT $first`,

      baseUrl = 'https://community.neo4j.com/'

      return session.run(query, params)
      .then( result => {
        return result.records.map(record => {

          let user = record.get("du").properties,
            repo = record.get("repo").properties;

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
      })
      .catch(error => {
        throw new Error(error);
      })
      .finally( ()=> {
        session.close();
      })
    },
    topCommunityBlogsAndContent: (_, params, context) => {

      let session = context.driver.session();

      // FIXME: inefficent query - computes score for all topics
      let query = `
      MATCH (u:DiscourseUser)-[:POSTED_CONTENT]->(t:DiscourseTopic)
      WHERE t.approved AND NOT "Exclude" IN labels(t)
      WITH *, 1.0 * (duration.inSeconds(datetime(), t.createdAt)).seconds/10000 AS ago
      WITH u, t, (10.0 * t.rating + coalesce(t.likeCount, 0) + coalesce(t.replyCount, 0))/(ago^2) AS score
      WITH u, COLLECT(t)[0] AS topic
      RETURN u, topic LIMIT $first
      `,
        baseUrl = 'https://community.neo4j.com/';

      return session.run(query, params)
      .then( result => {
        return result.records.map(record => {

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
      })
      .catch(error => {
        throw new Error(error);
      })
      .finally( ()=> {
        session.close();
      })
    },
    topNewCertifiedDevelopers: (_, params, context) => {

      let session = context.driver.session();

      let query = `
      MATCH (du:DiscourseUser)<-[:DISCOURSE_ACCOUNT]-(u:User)-[:TOOK]->(c:Certification {passed: true})
      RETURN du, u, c ORDER BY c.finished DESC LIMIT $first
      `;

      return session.run(query, params)
      .then( result => {
        return result.records.map(record => {

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
      })
      .catch(error => {
        throw new Error(error);
      })
      .finally( ()=> {
        session.close();
      })
    },
    thisWeekInNeo4j: (_, params, context) => {

      let session = context.driver.session();

      let query = `
      MATCH (t:TWIN4j)
      WITH t ORDER BY t.date DESC LIMIT 1 
      MATCH (t)-[:FEATURED]->(u:User)
      OPTIONAL MATCH (t)-[:CONTAINS_TAG]->(article:TWIN4jTag)
      WHERE article.anchor STARTS WITH "articles"
      WITH t, u, COLLECT(article) AS articles
      OPTIONAL MATCH (t)-[:CONTAINS_TAG]->(feature:TWIN4jTag)
      WHERE feature.anchor STARTS WITH "features"
      WITH t, u, articles, COLLECT(feature) AS features
      RETURN t, u, features, articles
      `,
      baseUrl = 'https://community.neo4j.com/'

      return session.run(query, params)
      .then( result => {

        var record = result.records[0];

          const twin4j = record.get("t").properties,
            user = record.get("u").properties;

          const features = record.get("features"),
                articles = record.get("articles");
          

          return {
            date: moment(new Date(twin4j.date)).format('Do MMM YYYY'),
            url: twin4j.link,
            text: twin4j.summaryText,
            featuredCommunityMember: {
              image: twin4j.image 
            },
            features: features.map((fn) => {
              const f = fn.properties;
              return {
                url: twin4j.link + '#' + f.anchor,
                tag: f.tag
              }
            }),
            articles: articles.map( (an) => {
              const a = an.properties;
              return {
                url: twin4j.link + '#' + a.anchor,
                tag: a.tag
              }
            })
          }  
        })
      .catch(error => {
        throw new Error(error);
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